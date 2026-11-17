import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';

const secret = () => {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32 || value.toLowerCase().includes('replace-with')) throw new Error('JWT_SECRET must be a unique random value of at least 32 characters');
  return value;
};

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const cookieToken = req.header('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith('smarttrace_session='))?.slice('smarttrace_session='.length);
  const token = cookieToken ? decodeURIComponent(cookieToken) : req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, secret(), { issuer: 'smarttrace-api', audience: 'smarttrace-web' }) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string' || typeof payload.loginId !== 'string' || !Object.values(UserRole).includes(payload.role as UserRole)) {
      return res.status(401).json({ error: 'Invalid authentication token' });
    }
    req.auth = { userId: payload.sub, role: payload.role as UserRole, loginId: payload.loginId };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}

export function authorize(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.auth.role)) return res.status(403).json({ error: 'Insufficient role permissions' });
    return next();
  };
}

export function signToken(user: { id: string; role: UserRole; loginId: string }) {
  return jwt.sign({ role: user.role, loginId: user.loginId }, secret(), {
    subject: user.id, issuer: 'smarttrace-api', audience: 'smarttrace-web', expiresIn: '8h',
  });
}

export function setSessionCookie(res: Response, token: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `smarttrace_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=28800${secure}`);
}

export function clearSessionCookie(res: Response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `smarttrace_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure}`);
}
