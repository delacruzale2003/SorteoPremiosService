import { Router } from 'express';
import { transaction, query } from '../db';
import { randomUUID } from 'crypto';

const publicRouter = Router();

// ====================================================================
// CONFIGURACIÓN DE LÍMITE DE PREMIOS POR PERSONA (Fácil de cambiar)
// ====================================================================
// Define el número máximo de premios que una persona puede reclamar
const MAX_PRIZES_PER_PERSON = 1; 


interface PrizeForDraw {
    id: string;
    name: string;
    available_stock: number;
}

/**
 * Función para seleccionar un premio basado en su peso (stock disponible).
 * Los premios con mayor available_stock tienen mayor probabilidad de ser seleccionados.
 */
function weightedRandom(prizes: PrizeForDraw[]): PrizeForDraw {
    // 1. Calcular el total del stock disponible (el peso total)
    const totalWeight = prizes.reduce((sum, prize) => sum + prize.available_stock, 0);
    
    if (totalWeight === 0) {
        throw new Error('No hay stock disponible para sortear.');
    }
    
    // 2. Elegir un número aleatorio entre 0 y el peso total
    let randomNumber = Math.random() * totalWeight;

    // 3. Iterar sobre los premios y restar su peso hasta encontrar el ganador
    for (const prize of prizes) {
        randomNumber -= prize.available_stock;
        if (randomNumber <= 0) {
            return prize; 
        }
    }
    return prizes[prizes.length - 1]; 
}

// ====================================================================
// RUTA CRÍTICA: FORMULARIO DE RECLAMO Y ENTREGA INMEDIATA
// ====================================================================

/**
 * Endpoint para el registro del usuario y entrega del premio.
 * URL: POST /api/v1/claim
 * Body esperado: { name: string, storeId: string, campaign: string, photoUrl?: string, phoneNumber?: string }
 */
publicRouter.post('/claim', async (req, res) => {
    // Los campos photoUrl y phoneNumber son opcionales en el body
    const { name, storeId, campaign, photoUrl, phoneNumber } = req.body; 

    // Validación Básica (requeridos para cualquier registro)
    if (!name || !storeId || !campaign) {
        return res.status(400).json({ message: 'Faltan datos requeridos (name, storeId, campaign).' });
    }

    let prizeName = 'N/A';
    let assignedPrizeId: string;
    let newRegisterId: string = randomUUID(); 

    // Normalizar a NULL si están vacíos. Esto es clave para la columna NULLABLE de MySQL.
    const finalPhotoUrl = photoUrl || null;
    const finalPhoneNumber = phoneNumber || null;


    try {
        // === VERIFICACIÓN DE LÍMITE POR PERSONA ===
        // Usamos el número de teléfono como identificador primario para el límite.
        // Si el número es NULL, usamos el nombre como fallback.
        const limitIdentifier = finalPhoneNumber ? finalPhoneNumber : name;
        
        // Consulta para contar registros: usa phone_number si existe, si no, usa el name.
        const [countRows] = await query(`
            SELECT COUNT(id) AS prize_count FROM registers 
            WHERE 
                (phone_number = ? OR (phone_number IS NULL AND name = ?)) 
                AND campaign = ?;
        `, [limitIdentifier, name, campaign]);
        
        const countResult = (countRows as { prize_count: number }[])[0].prize_count;
        
        if (countResult >= MAX_PRIZES_PER_PERSON) {
            return res.status(403).json({ 
                message: `Límite alcanzado. Ya has reclamado ${MAX_PRIZES_PER_PERSON} premio(s) con este identificador en esta campaña.` 
            });
        }
        // =======================================================
        

        // === PASO A: SELECCIÓN DE PREMIO CON SORTEO PONDERADO ===
        // 1. Obtener TODOS los premios disponibles y su stock.
        const [availablePrizesRows] = await query<PrizeForDraw>(`
            SELECT id, name, available_stock 
            FROM prizes 
            WHERE store_id = ? AND available_stock > 0;
        `, [storeId]);
        
        const availablePrizes = availablePrizesRows as PrizeForDraw[];

        if (availablePrizes.length === 0) {
            return res.status(409).json({ message: 'Lo sentimos, los premios para esta tienda se han agotado.' });
        }

        // 2. Realizar el sorteo para elegir el premio basado en la cantidad de stock
        const winningPrize = weightedRandom(availablePrizes);
        
        assignedPrizeId = winningPrize.id;
        prizeName = winningPrize.name;

        // === PASO B: INICIAR TRANSACCIÓN Y DECREMENTAR STOCK ===

        await transaction(async (connection) => {
            
            // 1. VERIFICAR y BLOQUEAR la fila del premio GANADOR (para asegurar el stock).
            const [prizeCheckRows] = await connection.execute(`
                SELECT available_stock
                FROM prizes
                WHERE id = ? AND available_stock > 0
                FOR UPDATE;
            `, [assignedPrizeId]);
            
            if ((prizeCheckRows as any[]).length === 0) {
                // El stock fue tomado por otra persona justo ahora.
                throw new Error('STOCK_LOST'); 
            }

            // 2. Decrementar el stock disponible atómicamente
            await connection.execute(`
                UPDATE prizes
                SET available_stock = available_stock - 1,
                    updated_at = NOW()
                WHERE id = ?;
            `, [assignedPrizeId]);

            // 3. Registrar la entrega (USAMOS los valores finalizados)
            await connection.execute(`
                INSERT INTO registers (id, name, store_id, prize_id, campaign, status, photo_url, phone_number)
                VALUES (?, ?, ?, ?, ?, 'CLAIMED', ?, ?);
            `, [newRegisterId, name, storeId, assignedPrizeId, campaign, finalPhotoUrl, finalPhoneNumber]);
        });

        res.status(200).json({
            message: '¡Premio entregado con éxito!',
            prize: prizeName,
            registerId: newRegisterId 
        });

    } catch (error) {
        if (error instanceof Error) {
            if (error.message === 'NO_STOCK' || error.message === 'STOCK_LOST') {
                return res.status(409).json({ message: 'Lo sentimos, los premios para esta tienda se han agotado o fueron tomados justo ahora. Inténtelo de nuevo.' });
            }
        }
        
        console.error('Error en el reclamo de premio:', error);
        res.status(500).json({ message: 'Error interno del servidor durante el proceso de reclamo.' });
    }
});

export default publicRouter;