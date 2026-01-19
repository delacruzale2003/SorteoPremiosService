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

// 💡 INTERFAZ PARA VERIFICACIÓN DE LÍMITE (GLOBAL)
interface ExistingRegistration {
    name: string;
    prize_name: string | null; // Nombre del premio asociado (NULL si no ganó)
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
// RUTA 1: RECLAMO Y ENTREGA INMEDIATA (Filtra solo por DNI)
// ====================================================================

/**
 * Endpoint para el registro del usuario y entrega del premio.
 * Body esperado: { name, storeId, campaign, photoUrl, phoneNumber, dni }
 */
publicRouter.post('/claim', async (req, res) => {
    const { name, storeId, campaign, photoUrl, phoneNumber, dni } = req.body; 

    // 1. Validación Básica (Instantánea)
    if (!name || !storeId || !campaign) {
        return res.status(400).json({ message: 'Faltan datos requeridos (name, storeId, campaign).' });
    }

    let prizeName = 'N/A';
    let assignedPrizeId: string;
    let newRegisterId: string = randomUUID(); 

    const finalPhotoUrl = photoUrl || null;
    const finalPhoneNumber = phoneNumber || null;
    const finalDni = dni || null; 

    try {
        // =======================================================
        // PASO 1: PARALELISMO (Optimización de Latencia)
        // Ejecutamos la validación de DNI y la búsqueda de premios AL MISMO TIEMPO.
        // =======================================================
        const [existingResult, prizesResult] = await Promise.all([
            query(`
                SELECT r.name, p.name AS prize_name
                FROM registers r
                LEFT JOIN prizes p ON r.prize_id = p.id
                WHERE r.dni = ? AND r.campaign = ?;
            `, [finalDni, campaign]),
            query<PrizeForDraw>(`
                SELECT id, name, available_stock 
                FROM prizes 
                WHERE store_id = ? AND available_stock > 0;
            `, [storeId])
        ]);

        const existingRegistrations = existingResult as ExistingRegistration[];
        const availablePrizes = prizesResult as PrizeForDraw[];

        // =======================================================
        // PASO 2: VALIDACIONES DE NEGOCIO
        // =======================================================
        
        // Verificación de límite por DNI (Gracias al índice que creaste, esto será veloz)
        if (existingRegistrations.length >= MAX_PRIZES_PER_PERSON) {
            const existing = existingRegistrations[0]; 
            return res.status(403).json({ 
                message: 'Ya ha sido registrado.',
                details: {
                    user: existing.name || 'Usuario desconocido',
                    prize: existing.prize_name || 'Participó / No ganó',
                    count: existingRegistrations.length,
                    limit: MAX_PRIZES_PER_PERSON,
                }
            });
        }

        // Verificación de stock disponible
        if (availablePrizes.length === 0) {
            return res.status(409).json({ message: 'Lo sentimos, los premios para esta tienda se han agotado.' });
        }

        // Selección de premio ponderado (Lógica interna del servidor)
        const winningPrize = weightedRandom(availablePrizes);
        assignedPrizeId = winningPrize.id;
        prizeName = winningPrize.name;

        // =======================================================
        // PASO 3: TRANSACCIÓN ATÓMICA (Seguridad de Stock)
        // =======================================================
        await transaction(async (connection) => {
            
            // 1. VERIFICAR y BLOQUEAR (FOR UPDATE evita que 2 personas ganen el mismo premio físico)
            const [prizeCheckRows] = await connection.execute(`
                SELECT available_stock
                FROM prizes
                WHERE id = ? AND available_stock > 0
                FOR UPDATE;
            `, [assignedPrizeId]);
            
            if ((prizeCheckRows as any[]).length === 0) {
                throw new Error('STOCK_LOST'); 
            }

            // 2. Decrementar el stock disponible
            await connection.execute(`
                UPDATE prizes
                SET available_stock = available_stock - 1,
                    updated_at = NOW()
                WHERE id = ?;
            `, [assignedPrizeId]);

            // 3. Registrar al ganador
            await connection.execute(`
                INSERT INTO registers (id, name, store_id, prize_id, campaign, status, photo_url, phone_number, dni)
                VALUES (?, ?, ?, ?, ?, 'CLAIMED', ?, ?, ?);
            `, [newRegisterId, name, storeId, assignedPrizeId, campaign, finalPhotoUrl, finalPhoneNumber, finalDni]);
        });

        // Respuesta final al Frontend (React)
        res.status(200).json({
            message: '¡Premio entregado con éxito!',
            prize: prizeName,
            registerId: newRegisterId,
            photoUrl: finalPhotoUrl
        });

    } catch (error) {
        if (error instanceof Error) {
            if (error.message === 'NO_STOCK' || error.message === 'STOCK_LOST') {
                return res.status(409).json({ 
                    message: 'Lo sentimos, el premio fue tomado por otra persona justo ahora. Inténtelo de nuevo.' 
                });
            }
        }
        
        console.error('Error en el reclamo de premio:', error);
        res.status(500).json({ message: 'Error interno del servidor durante el proceso de reclamo.' });
    }
});
publicRouter.post('/only-register', async (req, res) => {
    // 💡 NUEVOS CAMPOS RECIBIDOS
    const { name, campaign, photoUrl, phoneNumber, dni, voucherNumber } = req.body; 

    // Validación: name, campaign, phone, dni, voucherNumber (requeridos por el frontend)
    if (!name || !campaign || !phoneNumber || !dni || !voucherNumber) {
        return res.status(400).json({ message: 'Faltan datos requeridos (name, campaign, phoneNumber, dni, voucherNumber).' });
    }

    let newRegisterId: string = randomUUID();

    // Normalizar a NULL si están vacíos o no existen en el body
    const finalPhotoUrl = photoUrl || null;
    const finalVoucherNumber = voucherNumber || null;
    const finalPhoneNumber = phoneNumber || null; 
    const finalDni = dni || null; 

    try {
        // === VERIFICACIÓN DE UNICIDAD DEL VOUCHER ===
        const [voucherCheckRows] = await query(`
            SELECT id FROM registers 
            WHERE voucher_number = ? AND campaign = ?;
        `, [finalVoucherNumber, campaign]);
        
        if ((voucherCheckRows as any[]).length > 0) {
            // Si ya existe un registro con este número de comprobante en esta campaña
            return res.status(409).json({ 
                message: 'El número de comprobante ya ha sido registrado en esta campaña.' 
            });
        }
        // ============================================================


        // Ejecutar el registro
        await query(`
            INSERT INTO registers (
                id, 
                name, 
                campaign, 
                status, 
                phone_number, 
                dni, 
                photo_url, 
                voucher_number, 
                store_id, 
                prize_id
            )
            VALUES (?, ?, ?, 'REGISTERED', ?, ?, ?, ?, NULL, NULL);
        `, [
            newRegisterId, 
            name, 
            campaign, 
            finalPhoneNumber, 
            finalDni, 
            finalPhotoUrl, 
            finalVoucherNumber,
        ]);

        res.status(201).json({
            message: 'Registro exitoso.',
            registerId: newRegisterId,
        });

    } catch (error) {
        console.error('Error en el registro simple:', error);
        // 💡 CORRECCIÓN TIPO UNKNOWN Y ER_DUP_ENTRY
        if (error instanceof Error && 'code' in error && (error as any).code === 'ER_DUP_ENTRY') {
             return res.status(409).json({ message: 'Error de unicidad. El comprobante o DNI ya existe.' });
        }
        res.status(500).json({ message: 'Error interno del servidor durante el registro simple.' });
    }
});

publicRouter.post('/spin-roulette', async (req, res) => {
    // Solo necesitamos saber en qué tienda están y qué campaña es
    const { storeId, campaign } = req.body; 

    // Validación mínima
    if (!storeId || !campaign) {
        return res.status(400).json({ message: 'Faltan datos requeridos (storeId, campaign).' });
    }

    let prizeName = 'N/A';
    let assignedPrizeId: string;
    // Generamos el ID del registro nosotros mismos
    let newRegisterId: string = randomUUID(); 

    // Datos autogenerados para mantener la consistencia de la base de datos
    // Usamos un placeholder para el nombre ya que no hay input de usuario
    const anonymousName = `Cliente Ruleta - ${new Date().toLocaleTimeString()}`; 

    try {
        // === PASO 1: SELECCIÓN DE PREMIO (Igual que antes) ===
        const [availablePrizesRows] = await query<PrizeForDraw>(`
            SELECT id, name, available_stock 
            FROM prizes 
            WHERE store_id = ? AND available_stock > 0;
        `, [storeId]);
        
        const availablePrizes = availablePrizesRows as PrizeForDraw[];

        if (availablePrizes.length === 0) {
            return res.status(409).json({ message: 'Lo sentimos, los premios para esta tienda se han agotado.' });
        }

        // Algoritmo de peso para elegir el ganador
        const winningPrize = weightedRandom(availablePrizes);
        
        assignedPrizeId = winningPrize.id;
        prizeName = winningPrize.name;

        // === PASO 2: TRANSACCIÓN (Descontar stock y registrar) ===
        // Es vital mantener la transacción para evitar condiciones de carrera si 2 personas giran a la vez
        await transaction(async (connection) => {
            
            // A. Bloquear fila del premio para asegurar stock
            const [prizeCheckRows] = await connection.execute(`
                SELECT available_stock
                FROM prizes
                WHERE id = ? AND available_stock > 0
                FOR UPDATE;
            `, [assignedPrizeId]);
            
            if ((prizeCheckRows as any[]).length === 0) {
                throw new Error('STOCK_LOST'); 
            }

            // B. Decrementar stock
            await connection.execute(`
                UPDATE prizes
                SET available_stock = available_stock - 1,
                    updated_at = NOW()
                WHERE id = ?;
            `, [assignedPrizeId]);

            // C. Crear el registro ANÓNIMO
            // Pasamos NULL a phone, dni, photo_url, voucher_number
            // Asignamos el nombre genérico
            await connection.execute(`
                INSERT INTO registers (
                    id, 
                    name, 
                    store_id, 
                    prize_id, 
                    campaign, 
                    status, 
                    photo_url, 
                    phone_number, 
                    dni,
                    voucher_number
                )
                VALUES (?, ?, ?, ?, ?, 'CLAIMED', NULL, NULL, NULL, NULL);
            `, [newRegisterId, anonymousName, storeId, assignedPrizeId, campaign]);
        });

        // Respuesta exitosa al frontend
        res.status(200).json({
            message: '¡Premio obtenido!',
            prize: prizeName,
            registerId: newRegisterId,
            // Puedes devolver un flag para que el front sepa que fue anónimo
            isAnonymous: true 
        });

    } catch (error) {
        if (error instanceof Error) {
            // Manejo de concurrencia: si el stock se fue justo en el milisegundo entre la selección y la transacción
            if (error.message === 'NO_STOCK' || error.message === 'STOCK_LOST') {
                return res.status(409).json({ message: 'El premio seleccionado se agotó en este instante. Por favor gira de nuevo.' });
            }
        }
        
        console.error('Error en la ruleta anónima:', error);
        res.status(500).json({ message: 'Error interno al procesar el giro.' });
    }
});
publicRouter.post('/register-spin', async (req, res) => {
    // 1. Recibimos el email en lugar de phoneNumber
    const { storeId, campaign, name, dni, email } = req.body;

    // 2. Validación estricta incluyendo el nuevo campo
    if (!storeId || !campaign || !name || !dni || !email) {
        return res.status(400).json({ 
            message: 'Faltan datos requeridos (storeId, campaign, name, dni, email).' 
        });
    }

    let prizeName = 'N/A';
    let assignedPrizeId: string;
    let newRegisterId: string = randomUUID();

    try {
        // === PASO 1: SELECCIÓN DE PREMIO ===
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

        // === PASO 2: TRANSACCIÓN ===
        await transaction(async (connection) => {
            
            const [prizeCheckRows] = await connection.execute(`
                SELECT available_stock
                FROM prizes
                WHERE id = ? AND available_stock > 0
                FOR UPDATE;
            `, [assignedPrizeId]);
            
            if ((prizeCheckRows as any[]).length === 0) {
                throw new Error('STOCK_LOST'); 
            }

            await connection.execute(`
                UPDATE prizes
                SET available_stock = available_stock - 1,
                    updated_at = NOW()
                WHERE id = ?;
            `, [assignedPrizeId]);

            // C. Crear el registro con el campo EMAIL
            await connection.execute(`
                INSERT INTO registers (
                    id, 
                    name, 
                    store_id, 
                    prize_id, 
                    campaign, 
                    status, 
                    photo_url, 
                    email, 
                    dni,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, 'CLAIMED', NULL, ?, ?, NOW());
            `, [
                newRegisterId, 
                name, 
                storeId, 
                assignedPrizeId, 
                campaign, 
                email, // Nuevo campo inyectado
                dni
            ]);
        });

        res.status(200).json({
            success: true,
            message: '¡Registro exitoso y premio asignado!',
            prize: prizeName,
            registerId: newRegisterId,
            customer: { name, email } 
        });

    } catch (error) {
        if (error instanceof Error) {
            if (error.message === 'NO_STOCK' || error.message === 'STOCK_LOST') {
                return res.status(409).json({ message: 'El premio seleccionado se agotó en este instante. Por favor intenta de nuevo.' });
            }
        }
        console.error('Error en el registro con ruleta:', error);
        res.status(500).json({ message: 'Error interno al procesar el registro.' });
    }
});

export default publicRouter;