import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
// Importamos solo las funciones de conexión/transacción que se usan directamente aquí
import { testDbConnection } from './db'; 
// randomUUID ya no es necesario aquí, se usa dentro de public.routes.ts
// import { randomUUID } from 'crypto'; 

// Importamos los routers separados
import adminRouter from './routes/admin.routes';
import publicRouter from './routes/public.routes'; 

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsear el cuerpo de las peticiones JSON
app.use(express.json());

// Endpoint de prueba
app.get('/', (req: Request, res: Response) => {
    res.status(200).json({
        message: 'Servidor de Premios API funcionando!',
        environment: process.env.NODE_ENV || 'development'
    });
});

// ====================================================================
// CARGA DE RUTAS MODULARIZADAS
// ====================================================================

// Rutas de Administración (Creación, Consulta, Listados)
// Todas las rutas dentro de adminRouter se acceden vía /api/v1/admin/...
app.use('/api/v1/admin', adminRouter); 

// Rutas Públicas (Reclamo de Premio - POST /api/v1/claim)
// Las rutas públicas se acceden vía /api/v1/...
app.use('/api/v1', publicRouter);


// ====================================================================
// INICIALIZACIÓN DEL SERVIDOR
// ====================================================================
async function startServer() {
  try {
    // 1. Verificar la conexión a la base de datos (usando las credenciales de .env)
    await testDbConnection();
    
    // 2. Iniciar el servidor
    app.listen(PORT, () => {
      console.log(`⚡️ Servidor Express corriendo en http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('El servidor no pudo iniciar debido a errores de conexión a la DB o configuración.');
    process.exit(1); // Detener el proceso si la DB no está lista
  }
}

startServer();