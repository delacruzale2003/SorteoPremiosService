import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { testDbConnection } from './db'; 
import adminRouter from './routes/admin.routes';
import publicRouter from './routes/public.routes'; 
import path from "path";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsear el cuerpo de las peticiones JSON
app.use(express.json());

// Habilitar CORS
app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://localhost:5174", // tu frontend en desarrollo
    "https://tu-frontend-en-produccion.com" // tu dominio en producción
  ],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

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
app.use('/api/v1/admin', adminRouter); 
app.use('/api/v1', publicRouter);
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
// ====================================================================
// INICIALIZACIÓN DEL SERVIDOR
// ====================================================================
async function startServer() {
  try {
    await testDbConnection();
    app.listen(PORT, () => {
      console.log(`⚡️ Servidor Express corriendo en http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('El servidor no pudo iniciar debido a errores de conexión a la DB o configuración.');
    process.exit(1);
  }
}

startServer();
