import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';
import { prisma } from './db.js';

const { ADMIN_EMAIL, ADMIN_LOGIN_ID, ADMIN_NAME, ADMIN_PASSWORD } = process.env;
if (!ADMIN_EMAIL || !ADMIN_LOGIN_ID || !ADMIN_NAME || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
  throw new Error('Set ADMIN_EMAIL, ADMIN_LOGIN_ID, ADMIN_NAME, and ADMIN_PASSWORD (12+ chars) before seeding an administrator.');
}
try {
  await prisma.user.upsert({
    where:{email:ADMIN_EMAIL.toLowerCase()},
    create:{email:ADMIN_EMAIL.toLowerCase(),loginId:ADMIN_LOGIN_ID,name:ADMIN_NAME,passwordHash:await bcrypt.hash(ADMIN_PASSWORD,12),role:UserRole.ADMIN},
    update:{loginId:ADMIN_LOGIN_ID,name:ADMIN_NAME,passwordHash:await bcrypt.hash(ADMIN_PASSWORD,12),role:UserRole.ADMIN,active:true},
  });
  console.log(`Administrator ${ADMIN_LOGIN_ID} is ready.`);
} finally { await prisma.$disconnect(); }
