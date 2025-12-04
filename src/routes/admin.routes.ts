import { Router, Request, Response } from 'express';
import { query } from '../db';
import { randomUUID } from 'crypto';
import { ResultSetHeader } from 'mysql2/promise';
const adminRouter = Router();

// ============================================================
// Helpers
// ============================================================

interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: { code: string; details: string };
}

const sendResponse = <T>(
  res: Response,
  payload: ApiResponse<T>,
  status: number = 200
) => {
  res.status(status).json(payload);
};

const logError = (endpoint: string, error: any, extra: any = {}) => {
  console.error(`[${new Date().toISOString()}] ERROR in ${endpoint}`, {
    message: error.message,
    stack: error.stack,
    extra,
  });
};





adminRouter.post('/stores', async (req: Request, res: Response) => {
    const { name, campaign } = req.body;

    if (!name || !campaign) {
        return sendResponse(res, {
            success: false,
            message: 'Faltan datos requeridos: name y campaign.',
        }, 400);
    }

    const newId = randomUUID();

    try {
        // Se añade is_active = TRUE por defecto
        await query(
            `INSERT INTO stores (id, name, campaign, is_active) VALUES (?, ?, ?, TRUE);`,
            [newId, name, campaign]
        );

        sendResponse(res, {
            success: true,
            message: 'Tienda creada exitosamente.',
            data: { storeId: newId, name, campaign },
        }, 201);
    } catch (error: any) {
        logError('POST /stores', error, { body: req.body });
        sendResponse(res, {
            success: false,
            message: 'Error interno al crear la tienda.',
            error: { code: 'STORE_CREATE_ERROR', details: error.message },
        }, 500);
    }
});
// ============================================================
// ENDPOINT ACTUALIZADO CON TIPADO
// ============================================================
adminRouter.get('/stores', async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const offset = (page - 1) * limit;
        // Extraemos el filtro de la URL
        const campaignFilter = req.query.campaign as string | undefined;

        let whereClause = '';
        const queryParams: (string | number)[] = [];

        // Lógica para añadir el filtro de campaña
        if (campaignFilter) {
            whereClause = 'WHERE campaign = ?';
            queryParams.push(campaignFilter);
        }
        
        // Parámetros para la consulta principal (LIMIT y OFFSET van al final)
        const storeQueryParams = [...queryParams, limit, offset];

        // Consulta SQL LIMPIA - CORREGIDO CON .trim()
        const storesQuery = `
            SELECT id, name, campaign, is_active, created_at, updated_at
            FROM stores ${whereClause}
            ORDER BY name ASC
            LIMIT ? OFFSET ?
        `.trim(); // <<-- CORRECCIÓN APLICADA
        
        // Consulta de conteo SQL LIMPIA - CORREGIDO CON .trim()
        const countQuery = `SELECT COUNT(id) AS count FROM stores ${whereClause}`.trim(); // <<-- CORRECCIÓN APLICADA
        
        // El countQuery solo usa los parámetros de filtro
        const [storesResult, countResult] = await Promise.all([
            query(storesQuery, storeQueryParams),
            query(countQuery, queryParams),
        ]);

        // Aseguramos que el resultado de la consulta SELECT sea RowDataPacket[]
        const stores = storesResult[0]; 

        // Accedemos al conteo. Asumimos que el primer elemento del array de resultados
        // es el array de filas, y la primera fila es { count: number }.
        const totalItems = (countResult[0] as { count: number }[])[0].count; 
        const totalPages = Math.ceil(totalItems / limit);

        sendResponse(res, {
            success: true,
            message: 'Tiendas obtenidas exitosamente.',
            data: { stores, pagination: { totalItems, currentPage: page, limit, totalPages } },
        });
    } catch (error: any) {
        logError('GET /stores', error, { query: req.query });
        sendResponse(res, {
            success: false,
            message: 'Error interno del servidor al obtener tiendas.',
            error: { code: 'STORES_FETCH_ERROR', details: error.message },
        }, 500);
    }
});
adminRouter.put('/stores/:id', async (req: Request, res: Response) => {
    const storeId = req.params.id;
    const { name, campaign } = req.body;

    // --- 1. Validación de Campos Mínimos ---
    if (!name && !campaign) {
        return sendResponse(res, {
            success: false,
            message: 'Se requiere al menos un campo (name o campaign) para actualizar.',
        }, 400);
    }

    try {
        const updateFields: string[] = [];
        const updateParams: (string | number)[] = [];

        if (name) {
            updateFields.push('name = ?');
            updateParams.push(name);
        }
        if (campaign) {
            updateFields.push('campaign = ?');
            updateParams.push(campaign);
        }

        // Ya validamos updateFields.length > 0 arriba, pero no hace daño
        if (updateFields.length === 0) {
            return sendResponse(res, {
                success: false,
                message: 'No se proporcionaron campos válidos para actualizar.',
            }, 400);
        }

        // --- 2. Construcción y Ejecución de la Consulta ---
        const sql = `
            UPDATE stores
            SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?;
        `;
        const params = [...updateParams, storeId];
        
        // CORRECCIÓN CLAVE: Desestructuramos el array de resultados y forzamos el tipado.
        // La función query devuelve Promise<[T[], any]>. resultsArray[0] es el ResultSetHeader.
        const [resultsArray] = await query(sql, params); 
        
        // Forzamos el tipado del primer elemento del array a ResultSetHeader.
        // Se usa 'as unknown as' para superar la restricción de solapamiento si T es 'unknown[]'
        const resultHeader = resultsArray[0] as unknown as ResultSetHeader; 
        
        // --- 3. Verificación de Filas Afectadas ---
        if (resultHeader.affectedRows === 0) {
             return sendResponse(res, {
                 success: false,
                 message: 'Tienda no encontrada o no se realizaron cambios.',
             }, 404);
        }

        sendResponse(res, {
            success: true,
            message: 'Tienda actualizada exitosamente.',
            data: { storeId },
        });
    } catch (error: any) {
        logError(`PUT /stores/${storeId}`, error, { body: req.body });
        sendResponse(res, {
            success: false,
            message: 'Error interno al editar la tienda.',
            error: { code: 'STORE_UPDATE_ERROR', details: error.message },
        }, 500);
    }
});

adminRouter.patch('/stores/:id/deactivate', async (req: Request, res: Response) => {
    const storeId = req.params.id;

    try {
        const sql = `
            UPDATE stores
            SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND is_active = TRUE;
        `;
        
        const [result] = await query(sql, [storeId]);
        
        if ((result as any).affectedRows === 0) {
             return sendResponse(res, {
                success: false,
                message: 'Tienda no encontrada o ya estaba desactivada.',
            }, 404);
        }

        sendResponse(res, {
            success: true,
            message: 'Tienda desactivada exitosamente.',
            data: { storeId },
        });
    } catch (error: any) {
        logError(`PATCH /stores/${storeId}/deactivate`, error);
        sendResponse(res, {
            success: false,
            message: 'Error interno al desactivar la tienda.',
            error: { code: 'STORE_DEACTIVATE_ERROR', details: error.message },
        }, 500);
    }
});
/**
 * Crear premio
 * POST /api/v1/admin/prizes
 */
adminRouter.post('/prizes', async (req: Request, res: Response) => {
    const { storeId, name, description, initialStock } = req.body;
    const stock = parseInt(initialStock);

    if (!storeId || !name || isNaN(stock) || stock < 0) {
        return sendResponse(res, {
            success: false,
            message: 'Faltan datos requeridos o el stock es inválido.',
        }, 400);
    }

    const newId = randomUUID();

    try {
        // 1. Verificar que la tienda existe y está activa
        const [storeRows] = await query(`SELECT id FROM stores WHERE id = ? AND is_active = TRUE;`, [storeId]);

        if ((storeRows as any[]).length === 0) {
            return sendResponse(res, {
                success: false,
                message: 'La tienda con el ID proporcionado no existe o no está activa.',
            }, 404);
        }

        // 2. Insertar el premio
        await query(
            `INSERT INTO prizes (id, store_id, name, description, initial_stock, available_stock)
             VALUES (?, ?, ?, ?, ?, ?);`,
            [newId, storeId, name, description, stock, stock]
        );

        sendResponse(res, {
            success: true,
            message: 'Premio creado y stock inicializado exitosamente.',
            data: { prizeId: newId },
        }, 201);
    } catch (error: any) {
        logError('POST /prizes', error, { body: req.body });
        sendResponse(res, {
            success: false,
            message: 'Error interno al crear el premio.',
            error: { code: 'PRIZE_CREATE_ERROR', details: error.message },
        }, 500);
    }
});

/**
 * Obtener tiendas con paginación Y FILTRO POR CAMPAÑA
 * GET /api/v1/admin/stores?page=1&limit=10&campaign=[nombre]
 */

adminRouter.put('/prizes/:id', async (req: Request, res: Response) => {
    const prizeId = req.params.id;
    const { name, description, availableStock } = req.body;
    
    // El stock es opcional, pero si se proporciona, debe ser un número válido
    let stockAdjustment: number | undefined;
    if (availableStock !== undefined) {
        const parsedStock = parseInt(availableStock);
        if (isNaN(parsedStock) || parsedStock < 0) {
             return sendResponse(res, {
                success: false,
                message: 'El stock disponible proporcionado es inválido.',
            }, 400);
        }
        stockAdjustment = parsedStock;
    }

    if (!name && !description && stockAdjustment === undefined) {
        return sendResponse(res, {
            success: false,
            message: 'Se requiere al menos un campo (name, description o availableStock) para actualizar.',
        }, 400);
    }

    try {
        const updateFields: string[] = [];
        const updateParams: (string | number)[] = [];

        if (name) {
            updateFields.push('name = ?');
            updateParams.push(name);
        }
        if (description) {
            updateFields.push('description = ?');
            updateParams.push(description);
        }
        // Nota: Solo se ajusta el stock disponible, no el stock inicial (initial_stock)
        if (stockAdjustment !== undefined) {
            updateFields.push('available_stock = ?');
            updateParams.push(stockAdjustment);
        }

        const sql = `
            UPDATE prizes
            SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?;
        `;
        const params = [...updateParams, prizeId];
        
        const [result] = await query(sql, params);
        
        if ((result as any).affectedRows === 0) {
             return sendResponse(res, {
                success: false,
                message: 'Premio no encontrado o no se realizaron cambios.',
            }, 404);
        }

        sendResponse(res, {
            success: true,
            message: 'Premio actualizado exitosamente.',
            data: { prizeId },
        });
    } catch (error: any) {
        logError(`PUT /prizes/${prizeId}`, error, { body: req.body });
        sendResponse(res, {
            success: false,
            message: 'Error interno al editar el premio.',
            error: { code: 'PRIZE_UPDATE_ERROR', details: error.message },
        }, 500);
    }
});
/**
 * Obtener premios por ID de Tienda
 * GET /api/v1/admin/prizes/store/:storeId
 */
adminRouter.get('/prizes/store/:storeId', async (req: Request, res: Response) => {
    const storeId = req.params.storeId;

    try {
        // La consulta debe traer todos los premios para ese storeId
        const sql = `
            SELECT id, name, description, initial_stock, available_stock, created_at
            FROM prizes
            WHERE store_id = ?
            ORDER BY name ASC;
        `.trim(); // Usamos .trim() para evitar el error de sintaxis

        const [rows] = await query(sql, [storeId]);

        sendResponse(res, {
            success: true,
            message: 'Premios obtenidos exitosamente.',
            data: { prizes: rows },
        });

    } catch (error: any) {
        logError(`GET /prizes/store/${storeId}`, error);
        sendResponse(res, {
            success: false,
            message: 'Error interno del servidor al obtener premios.',
            error: { code: 'PRIZES_FETCH_ERROR', details: error.message },
        }, 500);
    }
});
/**
 * Obtener últimos registros
 * GET /api/v1/admin/registers/latest?campaign=[nombre]
 */
adminRouter.get('/registers/latest', async (req: Request, res: Response) => {
    const campaignFilter = req.query.campaign as string | undefined;
    let whereClause = '';
    let queryParams: string[] = [];

    if (campaignFilter) {
        whereClause = 'WHERE r.campaign = ?';
        queryParams.push(campaignFilter);
    }
    
    try {
        const sql = `
            SELECT 
                r.id, r.name, r.campaign, r.created_at, r.status,
                s.name AS store_name, 
                p.name AS prize_name
            FROM registers r
            JOIN stores s ON r.store_id = s.id
            JOIN prizes p ON r.prize_id = p.id
            ${whereClause}
            ORDER BY r.created_at DESC
            LIMIT 20;
        `;
        const [rows] = await query(sql, queryParams);

        sendResponse(res, {
            success: true,
            message: 'Últimos registros obtenidos exitosamente.',
            data: rows,
        });
    } catch (error: any) {
        logError('GET /registers/latest', error);
        sendResponse(res, {
            success: false,
            message: 'Error interno del servidor al obtener registros.',
            error: { code: 'REGISTERS_FETCH_ERROR', details: error.message },
        }, 500);
    }
});


export default adminRouter;