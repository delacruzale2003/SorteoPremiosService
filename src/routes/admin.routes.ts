import { Router, Request, Response } from 'express';
import { query } from '../db';
import { randomUUID } from 'crypto';

const adminRouter = Router();

// ============================================================
// Helpers (Manteniendo tu estructura de respuesta)
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

// ============================================================
// RUTAS DE ADMINISTRACIÓN
// ============================================================

/**
 * Crear tienda
 * POST /api/v1/admin/stores
 */
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
    await query(
      `INSERT INTO stores (id, name, campaign) VALUES (?, ?, ?);`,
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
    const [storeRows] = await query(`SELECT id FROM stores WHERE id = ?;`, [storeId]);

    if ((storeRows as any[]).length === 0) {
      return sendResponse(res, {
        success: false,
        message: 'La tienda con el ID proporcionado no existe.',
      }, 404);
    }

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
adminRouter.get('/stores', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    const campaignFilter = req.query.campaign as string | undefined;

    let whereClause = '';
    const queryParams: (string | number)[] = [];

    if (campaignFilter) {
        whereClause = 'WHERE campaign = ?';
        queryParams.push(campaignFilter);
    }
    
    // Parámetros para la consulta principal (LIMIT y OFFSET van al final)
    const storeQueryParams = [...queryParams, limit, offset];

    const storesQuery = `
      SELECT id, name, campaign, is_active, created_at, updated_at
      FROM stores
      ${whereClause}
      ORDER BY name ASC
      LIMIT ? OFFSET ?;
    `;
    const countQuery = `SELECT COUNT(id) AS count FROM stores ${whereClause};`;
    
    // El countQuery solo usa los parámetros de filtro (queryParams)
    const [storesResult, countResult] = await Promise.all([
      query(storesQuery, storeQueryParams),
      query(countQuery, queryParams),
    ]);

    const stores = storesResult[0];
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