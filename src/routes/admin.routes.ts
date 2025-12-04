import { Router } from 'express';
import { query } from '../db'; 
import { randomUUID } from 'crypto';

const adminRouter = Router();

// ====================================================================
// CRUD DE TIENDAS Y PREMIOS
// ====================================================================

/**
 * Endpoint para CREAR una nueva tienda (Store).
 * URL: POST /api/v1/admin/stores
 */
adminRouter.post('/stores', async (req, res) => {
    const { name, campaign } = req.body;
    
    if (!name || !campaign) {
        return res.status(400).json({ message: 'Faltan datos requeridos: name y campaign.' });
    }

    const newId = randomUUID();
    
    try {
        await query(`
            INSERT INTO stores (id, name, campaign)
            VALUES (?, ?, ?);
        `, [newId, name, campaign]);

        res.status(201).json({ 
            message: 'Tienda creada exitosamente.', 
            storeId: newId,
            name,
            campaign 
        });
    } catch (error) {
        console.error('Error al crear tienda:', error);
        res.status(500).json({ message: 'Error interno al crear la tienda.' });
    }
});

/**
 * Endpoint para ELIMINAR una tienda y sus premios.
 * URL: DELETE /api/v1/admin/stores/:id
 */
adminRouter.delete('/stores/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // La restricción ON DELETE CASCADE en la tabla prizes asegura 
        // que los premios asociados a esta store se eliminen automáticamente.
        const [result] = await query(`
            DELETE FROM stores WHERE id = ?;
        `, [id]);

        // En MySQL, el campo affectedRows indica cuántas filas fueron afectadas
        if ((result as any).affectedRows === 0) {
            return res.status(404).json({ message: 'Tienda no encontrada.' });
        }

        res.status(200).json({ message: 'Tienda eliminada exitosamente.' });
    } catch (error) {
        console.error('Error al eliminar tienda:', error);
        res.status(500).json({ message: 'Error interno al eliminar la tienda.' });
    }
});


/**
 * Endpoint para OBTENER los premios de una tienda específica.
 * URL: GET /api/v1/admin/stores/:storeId/prizes
 * CRÍTICO para EditStoreModal.tsx
 */
adminRouter.get('/stores/:storeId/prizes', async (req, res) => {
    const { storeId } = req.params;
    
    try {
        // Seleccionamos los campos necesarios para la edición de stock.
        const [prizesResult] = await query(`
            SELECT id, name, initial_stock, available_stock
            FROM prizes
            WHERE store_id = ?;
        `, [storeId]);

        // Retornamos el array de premios. Si está vacío, es un array vacío.
        res.status(200).json({ 
            data: prizesResult,
            storeId: storeId
        });
    } catch (error) {
        console.error('Error al obtener premios por tienda:', error);
        res.status(500).json({ message: 'Error interno al obtener la lista de premios.' });
    }
});


/**
 * Endpoint para CREAR un nuevo premio asociado a una tienda (Prize).
 * URL: POST /api/v1/admin/prizes
 */
adminRouter.post('/prizes', async (req, res) => {
    const { storeId, name, description, initialStock } = req.body;
    
    const stock = parseInt(initialStock);
    
    if (!storeId || !name || stock === undefined || isNaN(stock) || stock < 0) {
        return res.status(400).json({ message: 'Faltan datos requeridos o el stock es inválido.' });
    }

    const newId = randomUUID();
    
    try {
        // Validación: Verificar que la tienda exista
        const [storeRows] = await query(`SELECT id FROM stores WHERE id = ?;`, [storeId]);
        
        if ((storeRows as any[]).length === 0) {
            return res.status(404).json({ message: 'La tienda con el ID proporcionado no existe.' });
        }

        await query(`
            INSERT INTO prizes (id, store_id, name, description, initial_stock, available_stock)
            VALUES (?, ?, ?, ?, ?, ?);
        `, [newId, storeId, name, description, stock, stock]);

        res.status(201).json({ 
            message: 'Premio creado y stock inicializado exitosamente.', 
            prizeId: newId
        });
    } catch (error) {
        console.error('Error al crear premio:', error);
        res.status(500).json({ message: 'Error interno al crear el premio.' });
    }
});


/**
 * Endpoint para obtener tiendas con paginación (Admin).
 * URL: GET /api/v1/admin/stores?page=1&limit=10
 */
adminRouter.get('/stores', async (req, res) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const offset = (page - 1) * limit;

        // NOTA: Si el frontend necesita available_prizes_count aquí, 
        // la consulta debería usar un LEFT JOIN y SUM, lo cual es complejo.
        // Por ahora, solo devolvemos los datos de la tabla stores.
        const storesQuery = `
            SELECT id, name, campaign, is_active, created_at, updated_at
            FROM stores
            ORDER BY name ASC
            LIMIT ? OFFSET ?;
        `;
        const countQuery = `SELECT COUNT(id) AS count FROM stores;`;

        const [storesResult, countResult] = await Promise.all([
            query(storesQuery, [limit, offset]),
            query(countQuery)
        ]);

        const stores = storesResult[0]; 
        const totalItems = (countResult[0] as { count: number }[])[0].count; 
        const totalPages = Math.ceil(totalItems / limit);

        res.status(200).json({
            data: stores,
            pagination: { totalItems, currentPage: page, limit, totalPages }
        });

    } catch (error) {
        console.error('Error al obtener tiendas:', error);
        res.status(500).json({ message: 'Error interno del servidor al obtener tiendas.' });
    }
});

/**
 * Endpoint para obtener los últimos 20 registros (Admin).
 * URL: GET /api/v1/admin/registers/latest
 */
adminRouter.get('/registers/latest', async (req, res) => {
    try {
        const sql = `
            SELECT 
                r.id, r.name, r.campaign, r.created_at, r.status,
                s.name AS store_name, 
                p.name AS prize_name
            FROM registers r
            JOIN stores s ON r.store_id = s.id
            JOIN prizes p ON r.prize_id = p.id
            ORDER BY r.created_at DESC
            LIMIT 20;
        `;
        const [rows] = await query(sql);

        res.status(200).json({ data: rows });
    } catch (error) {
        console.error('Error al obtener registros:', error);
        res.status(500).json({ message: 'Error interno del servidor al obtener registros.' });
    }
});

export default adminRouter;