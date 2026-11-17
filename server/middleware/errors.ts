import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export function notFound(_req: Request, res: Response) { res.status(404).json({ error: 'API route not found' }); }
export function errors(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) return res.status(400).json({ error: 'Request validation failed', details: error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })) });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'A record with that unique value already exists' });
    if (error.code === 'P2025') return res.status(404).json({ error: 'Record not found' });
    if (error.code === 'P2003') return res.status(400).json({ error: 'Related record does not exist' });
  }
  if (error instanceof SyntaxError) return res.status(400).json({ error: 'Malformed JSON request body' });
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') return res.status(error.status).json({ error: (error as { message?: string }).message ?? 'Request failed' });
  console.error(error);
  return res.status(500).json({ error: 'Unexpected server error' });
}
