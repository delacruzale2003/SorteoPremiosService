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
// 1. Asegúrate de que NO haya espacios o barras finales en los strings
const allowedOrigins = [
    "http://localhost:5173", 
    "http://localhost:5174",
    "https://ccpremiosdic.onrender.com",
    "https://cocacolanavidadpromo.ptm.pe",
    "https://admincocacolanavidad.ptm.pe",
    "https://monsterpromo.ptm.pe",
    "http://cocacolanavidadpromo.ptm.pe",
    "https://ruletainkachips.onrender.com", // <--- Tu origen actual
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
    "https://sanluisfebrero.onrender.com",
    "https://schweppesfebrero.onrender.com"
];

app.use(cors({
    origin: (origin, callback) => {
        // Si no hay origin (como en herramientas de Postman o server-to-server) 
        // o si está en la lista blanca:
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.error(`CORS bloqueado para el origen: ${origin}`); // Útil para ver logs en Render
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"], // Añadido OPTIONS
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"], // Añadido X-Requested-With
    credentials: true // Recomendado para evitar problemas de sesión/headers
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
