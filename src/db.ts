import mysql, { Pool, ConnectionOptions, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// 💡 RECOMENDACIÓN: Si usas una base de datos compartida (ej. PlanetScale o plan gratuito), 
// 30 conexiones pueden ser muchas y causar errores de "Too many connections". 
// Si es un VPS dedicado, 30 está bien. Para planes gratis, mejor 5 o 10.
const DEFAULT_CONNECTION_LIMIT = 20; 

const dbConfig: ConnectionOptions = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || String(DEFAULT_CONNECTION_LIMIT), 10),
    
    waitForConnections: true,
    queueLimit: 0,
    timezone: 'Z', 

    // === OPTIMIZACIÓN KEEPALIVE ===
    enableKeepAlive: true,
    // CAMBIO: Mejor ponerlo en 0 para que el paquete de mantenimiento se active 
    // inmediatamente después de una consulta, reduciendo la ventana de cierre.
    keepAliveInitialDelay: 0, 
};

let pool: Pool;
try {
    pool = mysql.createPool(dbConfig);
} catch (error) {
    console.error('❌ Error fatal al crear el pool de MySQL:', error);
    process.exit(1); // Detener la app si no hay configuración de DB
}

/**
 * Función genérica para ejecutar consultas SQL con REINTENTO AUTOMÁTICO.
 * Esto soluciona el 99% de los ECONNRESET que ocurren "de vez en cuando".
 */
export const query = async <T extends RowDataPacket[] | ResultSetHeader | RowDataPacket[][]>(
    sql: string, 
    params?: any[]
): Promise<[T, any]> => {
    try {
        // Intento 1
        return await pool.execute<T>(sql, params);
    } catch (error: any) {
        // 🔄 LÓGICA DE REINTENTO (RETRY PATTERN)
        // Si el error es por conexión perdida, intentamos una vez más.
        if (error.code === 'ECONNRESET' || error.code === 'PROTOCOL_CONNECTION_LOST' || error.code === 'EPIPE') {
            console.warn(`⚠️ Error de red detectado (${error.code}). Reintentando consulta...`);
            try {
                // Intento 2 (Reintento)
                return await pool.execute<T>(sql, params);
            } catch (retryError) {
                console.error('❌ Falló el reintento de la consulta:', retryError);
                throw retryError;
            }
        }
        
        // Si no es error de conexión (ej: error de sintaxis SQL), lanzamos el error original
        console.error('❌ Error SQL:', sql, 'Params:', params, 'Error:', error.message);
        throw error;
    }
};

export async function testDbConnection() {
    try {
        // Usamos pool.query para pruebas simples
        await pool.query('SELECT 1');
        console.log('✅ Conexión a MySQL establecida y estable.');
    } catch (error) {
        console.error('❌ Error CRÍTICO de conexión a BD.');
        console.error(error);
        throw error;
    }
}

// Transaction Helper (Sin cambios, estaba bien)
export const transaction = async <T>(callback: (connection: PoolConnection) => Promise<T>): Promise<T> => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        return result;
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
};

export default pool;