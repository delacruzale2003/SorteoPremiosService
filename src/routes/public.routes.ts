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
 */
function weightedRandom(prizes: PrizeForDraw[]): PrizeForDraw {
    const totalWeight = prizes.reduce((sum, prize) => sum + prize.available_stock, 0);
    
    if (totalWeight === 0) {
        throw new Error('No hay stock disponible para sortear.');
    }
    
    let randomNumber = Math.random() * totalWeight;

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
 * Body esperado: { name: string, storeId: string, campaign: string, photoUrl?: string, phoneNumber?: string, dni?: string }
 */
publicRouter.post('/claim', async (req, res) => {
    // RECIBIMOS DNI
    const { name, storeId, campaign, photoUrl, phoneNumber, dni } = req.body; 

    // Validación Básica (requeridos para cualquier registro)
    if (!name || !storeId || !campaign) {
        return res.status(400).json({ message: 'Faltan datos requeridos (name, storeId, campaign).' });
    }

    let prizeName = 'N/A';
    let assignedPrizeId: string;
    let newRegisterId: string = randomUUID(); 

    // Normalizar a NULL si están vacíos o no existen en el body
    const finalPhotoUrl = photoUrl || null;
    const finalPhoneNumber = phoneNumber || null;
    const finalDni = dni || null; // Normalizar DNI


    try {
        // === VERIFICACIÓN DE LÍMITE POR PERSONA ===
        
        // 1. Definir el identificador más robusto para la verificación de límite: DNI > Teléfono > Nombre
        let limitIdentifier: string | null = null;
        
        if (finalDni) {
            limitIdentifier = finalDni;
        } else if (finalPhoneNumber) {
            limitIdentifier = finalPhoneNumber;
        } else {
            limitIdentifier = name;
        }

        // 2. Ejecutar la consulta de verificación de límite
        // La consulta revisa si ya existe un registro usando el DNI, o el Teléfono (si no hay DNI), o el Nombre (si no hay ninguno).
        const [countRows] = await query(`
            SELECT COUNT(id) AS prize_count FROM registers 
            WHERE 
                -- PRIORIDAD 1: Coincide el DNI (si DNI no es NULL)
                (dni = ? AND dni IS NOT NULL) OR 
                
                -- PRIORIDAD 2: Coincide el Teléfono Y el DNI es NULL
                (phone_number = ? AND phone_number IS NOT NULL AND dni IS NULL) OR
                
                -- PRIORIDAD 3: Coincide el Nombre Y Teléfono/DNI son NULL
                (name = ? AND phone_number IS NULL AND dni IS NULL)
                
                AND campaign = ?;
        `, [limitIdentifier, limitIdentifier, limitIdentifier, campaign]);
        
        const countResult = (countRows as { prize_count: number }[])[0].prize_count;
        
        if (countResult >= MAX_PRIZES_PER_PERSON) {
            return res.status(403).json({ 
                message: `Límite alcanzado. Ya has reclamado ${MAX_PRIZES_PER_PERSON} premio(s) con este identificador en esta campaña.` 
            });
        }
        // =======================================================
        

        // === PASO A: SELECCIÓN DE PREMIO CON SORTEO PONDERADO ===
        const [availablePrizesRows] = await query<PrizeForDraw>(`
            SELECT id, name, available_stock 
            FROM prizes 
            WHERE store_id = ? AND available_stock > 0;
        `, [storeId]);
        
        const availablePrizes = availablePrizesRows as PrizeForDraw[];

        if (availablePrizes.length === 0) {
            return res.status(409).json({ message: 'Lo sentimos, los premios para esta tienda se han agotado.' });
        }

        const winningPrize = weightedRandom(availablePrizes);
        
        assignedPrizeId = winningPrize.id;
        prizeName = winningPrize.name;

        // === PASO B: INICIAR TRANSACCIÓN Y DECREMENTAR STOCK ===

        await transaction(async (connection) => {
            
            // 1. VERIFICAR y BLOQUEAR la fila del premio GANADOR.
            const [prizeCheckRows] = await connection.execute(`
                SELECT available_stock
                FROM prizes
                WHERE id = ? AND available_stock > 0
                FOR UPDATE;
            `, [assignedPrizeId]);
            
            if ((prizeCheckRows as any[]).length === 0) {
                throw new Error('STOCK_LOST'); 
            }

            // 2. Decrementar el stock disponible atómicamente
            await connection.execute(`
                UPDATE prizes
                SET available_stock = available_stock - 1,
                    updated_at = NOW()
                WHERE id = ?;
            `, [assignedPrizeId]);

            // 3. Registrar la entrega (AÑADIMOS DNI)
            await connection.execute(`
                INSERT INTO registers (id, name, store_id, prize_id, campaign, status, photo_url, phone_number, dni)
                VALUES (?, ?, ?, ?, ?, 'CLAIMED', ?, ?, ?);
            `, [newRegisterId, name, storeId, assignedPrizeId, campaign, finalPhotoUrl, finalPhoneNumber, finalDni]);
        });

        res.status(200).json({
            message: '¡Premio entregado con éxito!',
            prize: prizeName,
            registerId: newRegisterId,
            photoUrl: finalPhotoUrl
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