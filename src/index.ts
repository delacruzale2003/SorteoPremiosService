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

app.use(express.json());

// === CONFIGURACIÓN CORS ===
// Tip: Mueve esto a un archivo separado si la lista crece mucho más
const allowedOrigins = [
    // Localhost
    "http://localhost:5173", 
    "http://localhost:5174",
    // Producción (Asegúrate de NO tener slashes '/' al final)
    "https://ccpremiosdic.onrender.com",
    "https://cocacolanavidadpromo.ptm.pe",
    "https://admincocacolanavidad.ptm.pe",
    "https://monsterpromo.ptm.pe",
    "http://cocacolanavidadpromo.ptm.pe",
    "https://ruletainkachips.onrender.com", 
    "https://ruleta-grfu.onrender.com",
    "https://ruletasodimac.ptm.pe",
    "https://adminflashlyte.ptm.pe",
    "https://flashlyteenero.onrender.com",
    "https://adminsprite.ptm.pe",
    "https://spriteenero.onrender.com",
    "https://adminschweppes.ptm.pe",
    "https://adminschweppesenero.ptm.pe",
    "https://schweppesenero.onrender.com",
    "https://admincocacolawc.ptm.pe",
    "https://ccmundial.onrender.com",
    "https://adminmonstertottus.ptm.pe",
    "https://ruletamonstertottus.onrender.com",
    "https://ruletasodimac.onrender.com",
    "https://adminsanluispoweradefebrero.ptm.pe",
    "https://sanluisfebrero.onrender.com"
];

app.use(cors({
    origin: (origin, callback) => {
        // Permitir solicitudes sin origen (como Postman o curl) y orígenes permitidos
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`⚠️ CORS bloqueado: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], // Agregué DELETE por si acaso
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true 
}));

// === RUTAS ===

// Health Check (Básico)
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'online',
    message: 'API Premios V1.0',
    env: process.env.NODE_ENV
  });
});

app.use('/api/v1/admin', adminRouter); 
app.use('/api/v1', publicRouter);

// Servir archivos estáticos (uploads)
// Asegúrate de que la carpeta exista o el path.join sea correcto según tu estructura de carpetas
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// === INICIO DEL SERVIDOR ===
async function startServer() {
  try {
    // 1. Probamos la DB antes de abrir el puerto
    await testDbConnection();
    
    // 2. Iniciamos el listener
    app.listen(PORT, () => {
      console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
      console.log(`📡 Modo: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('❌ Error fatal al iniciar:');
    console.error(err);
    process.exit(1); // Salir con error
  }
}

startServer();