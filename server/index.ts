import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { router } from './routes.js';
import { errors, notFound } from './middleware/errors.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set before starting the API');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.toLowerCase().includes('replace-with')) throw new Error('Set JWT_SECRET to a unique random value of at least 32 characters');
if (!process.env.IOT_INGEST_TOKEN || process.env.IOT_INGEST_TOKEN.length < 32 || process.env.IOT_INGEST_TOKEN.toLowerCase().includes('replace-with')) throw new Error('Set IOT_INGEST_TOKEN to a unique random value of at least 32 characters');

const app = express();
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin, credentials:true, methods:['GET','POST','PATCH','OPTIONS'], allowedHeaders:['Content-Type','Authorization','X-Device-Token'] }));
app.use(express.json({ limit:'128kb' }));
app.use('/api/auth', rateLimit({ windowMs:15*60*1000, limit:30, standardHeaders:'draft-8', legacyHeaders:false }));
app.use('/api',router);
app.use(notFound);
app.use(errors);

const port = Number(process.env.PORT ?? 4000);
app.listen(port,()=>console.log(`SmartTrace API listening on http://localhost:${port}`));
