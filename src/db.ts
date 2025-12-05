import mysql, { Pool, ConnectionOptions, Connection } from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// Define un límite por defecto más robusto para entornos de alta concurrencia
const DEFAULT_CONNECTION_LIMIT = 30; 

// --- CONFIGURACIÓN DE CONEXIÓN MYSQL OPTIMIZADA ---
const dbConfig: ConnectionOptions = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    
    // 💡 AUMENTADO y CONFIGURABLE: 30 es un valor seguro para 20 tiendas con alta concurrencia.
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || String(DEFAULT_CONNECTION_LIMIT), 10),
    
    waitForConnections: true,
    queueLimit: 0,
    timezone: 'Z', 

    // === SOLUCIÓN CRÍTICA ANTI-ECONNRESET ===
    // Habilita el envío de paquetes para mantener viva la conexión TCP
    enableKeepAlive: true,
    // Comienza a enviar paquetes de mantenimiento después de 5 segundos de inactividad
    keepAliveInitialDelay: 5000, 
};

// Crear el Pool de Conexiones
let pool: Pool;
try {
    pool = mysql.createPool(dbConfig);
} catch (error) {
    console.error('Error al crear el pool de MySQL. Verifique dbConfig:', error);
    throw new Error('Configuración de base de datos incorrecta.');
}

/**
 * Función genérica para ejecutar consultas SQL.
 * Usaremos '?' para placeholders.
 * @param sql La consulta SQL.
 * @param params Array de valores para los placeholders.
 * @returns El resultado (filas y metadatos) de la consulta.
 */
export const query = async <T>(sql: string, params?: any[]): Promise<[T[], any]> => {
    try {
        return await pool.execute(sql, params) as [T[], any];
    } catch (error) {
        console.error('Error al ejecutar consulta SQL:', sql, params, error);
        throw error;
    }
};

/**
 * Función para verificar la conexión a la base de datos.
 */
export async function testDbConnection() {
    try {
        await pool.query('SELECT 1 + 1 AS solution;');
        console.log('✅ Conexión a MySQL establecida correctamente.');
    } catch (error) {
        console.error('❌ Error al conectar a MySQL. Verifique su archivo .env y el servidor DB.');
        console.error(error);
        throw new Error('No se pudo establecer conexión con la base de datos.');
    }
}

/**
 * Función para ejecutar una transacción con múltiples consultas.
 * CRUCIAL para manejar la lógica de stock de forma atómica: 
 * 1. Buscar premio y bloquear stock.
 * 2. Decrementar stock.
 * 3. Crear registro.
 * Si algo falla, se revierte (ROLLBACK).
 * @param callback La función que contiene la lógica de la transacción, recibe un objeto Connection.
 */
export const transaction = async <T>(callback: (connection: Connection) => Promise<T>): Promise<T> => {
    const connection = await pool.getConnection(); // Obtener una conexión del pool
    try {
        await connection.beginTransaction(); // Iniciar la transacción
        const result = await callback(connection);
        await connection.commit(); // Confirmar la transacción
        return result;
    } catch (e) {
        await connection.rollback(); // Revertir si hay un error
        throw e;
    } finally {
        connection.release(); // Liberar la conexión al pool
    }
};

// Opcional: Exportar el Pool para uso avanzado, aunque es mejor usar las funciones query/transaction
export default pool;