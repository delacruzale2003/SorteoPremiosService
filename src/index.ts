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
const allowedOrigins = [
    // 1. Entorno de Desarrollo (HTTP)
    "http://localhost:5173", 
    "http://localhost:5174",
    
    // 2. Entorno de Producción (Render)
    "https://ccpremiosdic.onrender.com", // Asegúrate de que Render usa HTTPS
    
    // 3. Dominio Personalizado Final (AÑADIR HTTPS)
    "https://cocacolanavidadpromo.ptm.pe", // <--- ¡CORRECCIÓN CLAVE AQUÍ!
    "https://admincocacolanavidad.ptm.pe", // También corrige el de admin por si acaso
    "https://monsterpromo.ptm.pe",
    // Para mayor seguridad durante la migración o si no estás seguro:
    "http://cocacolanavidadpromo.ptm.pe", 
];


app.use(cors({
  origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'), false);
        }
    },
  methods: ["GET", "POST","PUT", "PATCH"],
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
