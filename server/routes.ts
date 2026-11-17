import { Router } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PriceStage, Prisma, ShipmentStatus, TagStatus, UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from './db.js';
import { authenticate, authorize, clearSessionCookie, setSessionCookie, signToken } from './middleware/auth.js';

export const router = Router();
const asyncRoute = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res)).catch(next);
const parse = <T,>(schema: z.ZodType<T>, body: unknown): T => schema.parse(body);
const registerSchema = z.object({ email:z.string().trim().email().max(254), password:z.string().min(12).max(128), confirmPassword:z.string().min(12).max(128), name:z.string().trim().min(2).max(100), phone:z.string().trim().min(7).max(25).regex(/^[+0-9(). -]+$/).refine(value=>value.replace(/\D/g,'').length>=7,'Enter a valid phone number'), role:z.enum(['FARMER','RETAILER']), farmName:z.string().trim().min(2).max(120).optional(), businessName:z.string().trim().min(2).max(120).optional(), location:z.string().trim().min(2).max(180) }).refine(data=>data.password===data.confirmPassword,{path:['confirmPassword'],message:'Passwords do not match'});
const loginSchema = z.object({ identifier:z.string().trim().min(1), password:z.string().min(1).max(128) });
const batchSchema = z.object({ batchCode:z.string().trim().min(3).max(60).optional(), origin:z.string().trim().min(2).max(180), quantity:z.number().int().positive(), totalWeightKg:z.number().positive(), crateCode:z.string().trim().min(3).max(60).optional(), crateQuantity:z.number().int().positive().optional(), crateWeightKg:z.number().positive().optional(), farmerPurchasePrice:z.number().positive().optional(), retailerLoginId:z.string().trim().min(2),destination:z.string().trim().min(2).max(180),vehicle:z.string().trim().max(80).optional(),nfcUid:z.string().trim().min(3).max(128).optional() }).refine(d => (d.crateQuantity ?? d.quantity) <= d.quantity, {path:['crateQuantity'],message:'Crate quantity cannot exceed batch quantity'}).refine(d => (d.crateWeightKg ?? d.totalWeightKg) <= d.totalWeightKg, {path:['crateWeightKg'],message:'Crate weight cannot exceed batch weight'});
const crateSchema = z.object({ crateCode:z.string().trim().min(3).max(60), batchId:z.string().uuid(), quantity:z.number().int().positive(), weightKg:z.number().positive() });
const tagSchema = z.object({ uid:z.string().trim().min(3).max(128), crateId:z.string().uuid() });
const dispatchSchema = z.object({ retailerLoginId:z.string().trim().min(2), destination:z.string().trim().min(2).max(180), vehicle:z.string().trim().max(80).optional() });
const priceSchema = z.object({ amount:z.number().positive(), quantity:z.number().int().nonnegative().optional() });
const ingestSchema = z.object({ deviceId:z.string().trim().min(2).max(100), crateId:z.string().uuid(), temperature:z.number().min(-60).max(120).optional(), humidity:z.number().min(0).max(100).optional(), latitude:z.number().min(-90).max(90).optional(), longitude:z.number().min(-180).max(180).optional(), recordedAt:z.string().datetime().optional() }).refine(v => v.temperature !== undefined || v.humidity !== undefined || (v.latitude !== undefined && v.longitude !== undefined), 'Provide at least one sensor value or a complete GPS coordinate');
const publicUser = { select: { id:true, loginId:true, name:true, role:true, farmer:{select:{farmName:true,location:true}}, retailer:{select:{businessName:true,location:true}} } } as const;
const traceParty = { select: { name:true, farmer:{select:{farmName:true,location:true}}, retailer:{select:{businessName:true,location:true}} } } as const;

router.get('/health', (_req,res) => res.json({ status:'ok', service:'smarttrace-api' }));

router.post('/auth/register', asyncRoute(async (req,res) => {
  const data = parse(registerSchema, req.body);
  if (data.role === 'FARMER' && !data.farmName) return res.status(400).json({ error:'Farm name is required for farmers' });
  if (data.role === 'RETAILER' && !data.businessName) return res.status(400).json({ error:'Business name is required for retailers' });
  const passwordHash = await bcrypt.hash(data.password, 12);
  const prefix = data.role === 'FARMER' ? 'FARM' : 'RET';
  // Retry the improbable random collision; the unique DB constraint remains authoritative.
  let user;
  for (let attempt = 0; attempt < 3; attempt++) {
    const loginId = `${prefix}-${randomBytes(5).toString('hex').toUpperCase()}`;
    try {
      user = await prisma.user.create({ data:{ email:data.email.toLowerCase(), loginId, phone:data.phone, passwordHash, name:data.name, role:data.role,
    ...(data.role === 'FARMER' ? { farmer:{create:{farmName:data.farmName!,location:data.location}} } : { retailer:{create:{businessName:data.businessName!,location:data.location}} }) }, select:publicUser.select });
      break;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002' || attempt === 2) throw error;
      // If email collided, retrying won't help. Login ID collisions are the only expected random conflict.
      const existing = await prisma.user.findUnique({where:{email:data.email.toLowerCase()},select:{id:true}});
      if (existing) throw error;
    }
  }
  if (!user) throw new Error('Unable to allocate a unique login ID');
  setSessionCookie(res,signToken({id:user.id,role:data.role,loginId:user.loginId}));
  return res.status(201).json({ user });
}));

router.post('/auth/login', asyncRoute(async (req,res) => {
  const data = parse(loginSchema,req.body);
  const identifier = data.identifier.trim();
  const user = await prisma.user.findFirst({ where:{ OR:[{email:identifier.toLowerCase()},{loginId:{equals:identifier,mode:'insensitive'}}], active:true } });
  if (!user || !(await bcrypt.compare(data.password,user.passwordHash))) return res.status(401).json({error:'Invalid login ID/email or password'});
  const details = await prisma.user.findUniqueOrThrow({where:{id:user.id},...publicUser});
  setSessionCookie(res,signToken(user));
  return res.json({user:details});
}));

router.get('/auth/me', authenticate, asyncRoute(async (req,res) => {
  const user = await prisma.user.findUnique({where:{id:req.auth!.userId},...publicUser});
  if (!user) return res.status(401).json({error:'Account no longer exists'});
  return res.json({user});
}));
router.get('/retailers', authenticate, authorize(UserRole.FARMER), asyncRoute(async (_req,res) => {
  const data=await prisma.user.findMany({where:{role:UserRole.RETAILER,active:true},select:{id:true,loginId:true,name:true,retailer:{select:{businessName:true,location:true}}},orderBy:{name:'asc'}});
  return res.json({data});
}));
router.patch('/profile', authenticate, asyncRoute(async (req,res) => {
  const data=parse(z.object({farmName:z.string().trim().min(2).max(120),location:z.string().trim().min(2).max(180)}),req.body);
  if(req.auth!.role!==UserRole.FARMER) return res.status(403).json({error:'Only farmer accounts have an editable farm profile'});
  const profile=await prisma.farmer.upsert({where:{userId:req.auth!.userId},create:{userId:req.auth!.userId,...data},update:data});
  return res.json({data:profile});
}));
router.post('/auth/logout', (_req,res) => { clearSessionCookie(res); return res.json({ok:true}); });

router.get('/batches', authenticate, asyncRoute(async (req,res) => {
  const where = req.auth!.role === UserRole.FARMER ? {farmerId:req.auth!.userId} : req.auth!.role === UserRole.RETAILER ? {shipments:{some:{retailerId:req.auth!.userId}}} : {};
  const retailerShipments = req.auth!.role === UserRole.RETAILER ? {where:{retailerId:req.auth!.userId}} : {};
  const retailerCrates = req.auth!.role === UserRole.RETAILER ? {where:{shipments:{some:{retailerId:req.auth!.userId}}}} : {};
  const batches = await prisma.chickenBatch.findMany({where,include:{farmer:publicUser,crates:{...retailerCrates,include:{nfcTag:{include:{scans:{orderBy:{scannedAt:'desc'},take:20}}},shipments:{...retailerShipments,include:{retailer:publicUser},orderBy:{createdAt:'desc'}},stocks:{where:req.auth!.role===UserRole.RETAILER?{retailerId:req.auth!.userId}:{}},readings:{orderBy:{recordedAt:'desc'},take:100},locations:{orderBy:{recordedAt:'desc'},take:100}}} ,prices:{orderBy:{createdAt:'asc'}}},orderBy:{createdAt:'desc'}});
  return res.json({data:batches});
}));
router.post('/batches', authenticate, authorize(UserRole.FARMER), asyncRoute(async (req,res) => {
  const d=parse(batchSchema,req.body); const farmer=await prisma.farmer.findUnique({where:{userId:req.auth!.userId}});
  if(!farmer) return res.status(409).json({error:'Farmer profile is missing'});
  if(!farmer.farmName.trim() || !farmer.location.trim()) return res.status(409).json({error:'Complete your farm name and location in Farmer Profile before registering a batch'});
  const retailer=await prisma.user.findFirst({where:{loginId:d.retailerLoginId,role:UserRole.RETAILER,active:true}});
  if(!retailer)return res.status(404).json({error:'Retailer account not found'});
  const batch=await prisma.$transaction(async tx=>{
    const uniqueCode=(prefix:string)=>`${prefix}-${randomBytes(6).toString('hex').toUpperCase()}`;
    const created=await tx.chickenBatch.create({data:{batchCode:d.batchCode??uniqueCode('BAT'),farmerId:req.auth!.userId,origin:d.origin,quantity:d.quantity,totalWeightKg:d.totalWeightKg,
      ...(d.farmerPurchasePrice?{prices:{create:{actorId:req.auth!.userId,stage:PriceStage.FARMER_PURCHASE,amount:d.farmerPurchasePrice}}}:{})}});
    const crate=await tx.crate.create({data:{crateCode:d.crateCode??uniqueCode('CRT'),batchId:created.id,quantity:d.crateQuantity??d.quantity,weightKg:d.crateWeightKg??d.totalWeightKg}});
    const shipment=await tx.shipment.create({data:{shipmentCode:uniqueCode('SHP'),batchId:created.id,crateId:crate.id,farmerId:req.auth!.userId,retailerId:retailer.id,destination:d.destination,vehicle:d.vehicle}});
    const tag=d.nfcUid?await tx.nFCTag.create({data:{uid:d.nfcUid.toUpperCase(),crateId:crate.id,batchId:created.id,status:TagStatus.ASSIGNED,assignedAt:new Date()}}):null;
    const retailerSummary={id:retailer.id,loginId:retailer.loginId,name:retailer.name,retailerProfile:await tx.retailer.findUnique({where:{userId:retailer.id}})};
    return {...created,crates:[{...crate,nfcTag:tag,shipments:[{...shipment,retailer:retailerSummary}]}]};
  });
  return res.status(201).json({data:batch});
}));
router.get('/batches/:id',authenticate,asyncRoute(async(req,res)=>{const b=await prisma.chickenBatch.findUnique({where:{id:req.params.id},include:{farmer:publicUser,crates:{include:{nfcTag:true,shipments:{where:req.auth!.role===UserRole.RETAILER?{retailerId:req.auth!.userId}:{},include:{retailer:publicUser},orderBy:{createdAt:'desc'}},readings:{orderBy:{recordedAt:'desc'},take:100},locations:{orderBy:{recordedAt:'desc'},take:100}}},prices:{orderBy:{createdAt:'desc'}}}});if(!b)return res.status(404).json({error:'Batch not found'});if(req.auth!.role===UserRole.FARMER&&b.farmerId!==req.auth!.userId)return res.status(403).json({error:'Access denied'});if(req.auth!.role===UserRole.RETAILER&&!b.crates.some(c=>c.shipments.length))return res.status(403).json({error:'Access denied'});return res.json({data:b})}));
router.post('/crates',authenticate,authorize(UserRole.FARMER),asyncRoute(async(req,res)=>{const d=parse(crateSchema,req.body);const b=await prisma.chickenBatch.findFirst({where:{id:d.batchId,farmerId:req.auth!.userId}});if(!b)return res.status(404).json({error:'Batch not found'});const crate=await prisma.crate.create({data:d});return res.status(201).json({data:crate})}));
router.get('/crates',authenticate,asyncRoute(async(req,res)=>{const where=req.auth!.role===UserRole.FARMER?{batch:{farmerId:req.auth!.userId}}:req.auth!.role===UserRole.RETAILER?{shipments:{some:{retailerId:req.auth!.userId}}}:{};const data=await prisma.crate.findMany({where,include:{batch:{include:{farmer:publicUser}},nfcTag:true,shipments:{where:req.auth!.role===UserRole.RETAILER?{retailerId:req.auth!.userId}:{},orderBy:{createdAt:'desc'}},stocks:{where:req.auth!.role===UserRole.RETAILER?{retailerId:req.auth!.userId}:{}}},orderBy:{createdAt:'desc'}});return res.json({data})}));

router.post('/shipments',authenticate,authorize(UserRole.FARMER),asyncRoute(async(req,res)=>{const d=parse(dispatchSchema.extend({crateId:z.string().uuid()}),req.body);const crate=await prisma.crate.findFirst({where:{id:d.crateId,batch:{farmerId:req.auth!.userId},shipments:{none:{status:{in:[ShipmentStatus.READY,ShipmentStatus.IN_TRANSIT]}}}},include:{batch:true}});if(!crate)return res.status(404).json({error:'Available crate not found'});const retailer=await prisma.user.findFirst({where:{loginId:d.retailerLoginId,role:UserRole.RETAILER,active:true}});if(!retailer)return res.status(404).json({error:'Retailer account not found'});const shipment=await prisma.shipment.create({data:{shipmentCode:`SHP-${Date.now().toString(36).toUpperCase()}`,batchId:crate.batchId,crateId:crate.id,farmerId:req.auth!.userId,retailerId:retailer.id,destination:d.destination,vehicle:d.vehicle}});return res.status(201).json({data:shipment})}));
router.post('/shipments/:id/dispatch',authenticate,authorize(UserRole.FARMER),asyncRoute(async(req,res)=>{const s=await prisma.shipment.findFirst({where:{id:req.params.id,farmerId:req.auth!.userId,status:ShipmentStatus.READY}});if(!s)return res.status(404).json({error:'Ready shipment not found'});const data=await prisma.$transaction(async tx=>{const shipment=await tx.shipment.update({where:{id:s.id},data:{status:ShipmentStatus.IN_TRANSIT,dispatchedAt:new Date()}});await tx.chickenBatch.update({where:{id:s.batchId},data:{status:'IN_TRANSIT'}});return shipment});return res.json({data})}));
router.get('/shipments',authenticate,asyncRoute(async(req,res)=>{const where=req.auth!.role===UserRole.FARMER?{farmerId:req.auth!.userId}:req.auth!.role===UserRole.RETAILER?{retailerId:req.auth!.userId}:{};return res.json({data:await prisma.shipment.findMany({where,include:{batch:{include:{farmer:publicUser}},crate:true,retailer:publicUser,farmer:publicUser},orderBy:{createdAt:'desc'}})})}));
router.post('/shipments/:id/receive',authenticate,authorize(UserRole.RETAILER),asyncRoute(async(req,res)=>{const shipment=await prisma.shipment.findFirst({where:{id:req.params.id,retailerId:req.auth!.userId,status:ShipmentStatus.IN_TRANSIT},include:{crate:true}});if(!shipment)return res.status(404).json({error:'Incoming shipment not found'});const result=await prisma.$transaction(async tx=>{const updated=await tx.shipment.update({where:{id:shipment.id},data:{status:ShipmentStatus.DELIVERED,receivedAt:new Date()}});const outstanding=await tx.shipment.count({where:{batchId:shipment.batchId,status:{in:[ShipmentStatus.READY,ShipmentStatus.IN_TRANSIT]}}});if(outstanding===0)await tx.chickenBatch.update({where:{id:shipment.batchId},data:{status:'DELIVERED'}});await tx.stock.upsert({where:{retailerId_crateId:{retailerId:req.auth!.userId,crateId:shipment.crateId}},create:{retailerId:req.auth!.userId,crateId:shipment.crateId,quantity:shipment.crate.quantity},update:{}});return updated});return res.json({data:result})}));
router.get('/stock',authenticate,authorize(UserRole.RETAILER,UserRole.ADMIN),asyncRoute(async(req,res)=>res.json({data:await prisma.stock.findMany({where:req.auth!.role===UserRole.ADMIN?{}:{retailerId:req.auth!.userId},include:{crate:{include:{batch:true}}},orderBy:{updatedAt:'desc'}})})));
router.patch('/crates/:crateId/stock',authenticate,authorize(UserRole.RETAILER),asyncRoute(async(req,res)=>{const d=parse(z.object({quantity:z.number().int().nonnegative()}),req.body);const owned=await prisma.stock.findUnique({where:{retailerId_crateId:{retailerId:req.auth!.userId,crateId:req.params.crateId}}});if(!owned)return res.status(404).json({error:'Retailer stock record not found'});return res.json({data:await prisma.stock.update({where:{id:owned.id},data:{quantity:d.quantity}})})}));
router.post('/crates/:crateId/prices', authenticate, authorize(UserRole.RETAILER, UserRole.ADMIN), asyncRoute(async (req, res) => {
  const d = parse(priceSchema, req.body);
  const shipment = await prisma.shipment.findFirst({ where:{crateId:req.params.crateId,retailerId:req.auth!.userId,status:ShipmentStatus.DELIVERED} });
  if (req.auth!.role === UserRole.RETAILER && !shipment) return res.status(403).json({error:'Only the receiving retailer can record this selling price'});
  const crate = shipment ? null : await prisma.crate.findUnique({where:{id:req.params.crateId}});
  if (!shipment && !crate) return res.status(404).json({error:'Crate not found'});
  const record = await prisma.priceHistory.create({data:{batchId:shipment?.batchId??crate!.batchId,actorId:req.auth!.userId,stage:PriceStage.CUSTOMER_SELLING,amount:d.amount}});
  if (d.quantity!==undefined && req.auth!.role===UserRole.RETAILER) await prisma.stock.update({where:{retailerId_crateId:{retailerId:req.auth!.userId,crateId:req.params.crateId}},data:{quantity:d.quantity}});
  return res.status(201).json({data:record});
}));

router.get('/nfc',authenticate,asyncRoute(async(req,res)=>{const where=req.auth!.role===UserRole.FARMER?{crate:{batch:{farmerId:req.auth!.userId}}}:req.auth!.role===UserRole.RETAILER?{crate:{shipments:{some:{retailerId:req.auth!.userId}}}}:{};return res.json({data:await prisma.nFCTag.findMany({where,include:{crate:{include:{batch:true}},scans:{orderBy:{scannedAt:'desc'},take:20}},orderBy:{registeredAt:'desc'}})})}));
router.post('/nfc',authenticate,authorize(UserRole.FARMER,UserRole.ADMIN),asyncRoute(async(req,res)=>{const d=parse(tagSchema,req.body);const crate=await prisma.crate.findFirst({where:{id:d.crateId,...(req.auth!.role===UserRole.FARMER?{batch:{farmerId:req.auth!.userId}}:{})},include:{nfcTag:true}});if(!crate)return res.status(404).json({error:'Crate not found'});if(crate.nfcTag)return res.status(409).json({error:'Crate already has an NFC tag; reassignment is not allowed'});const tag=await prisma.nFCTag.create({data:{uid:d.uid.trim().toUpperCase(),crateId:crate.id,batchId:crate.batchId,status:TagStatus.ASSIGNED,assignedAt:new Date()}});return res.status(201).json({data:tag})}));
router.patch('/nfc/:uid/deactivate',authenticate,authorize(UserRole.FARMER,UserRole.ADMIN),asyncRoute(async(req,res)=>{const tag=await prisma.nFCTag.findUnique({where:{uid:req.params.uid.toUpperCase()},include:{crate:{include:{batch:true}}}});if(!tag)return res.status(404).json({error:'NFC tag not found'});if(req.auth!.role===UserRole.FARMER&&tag.crate?.batch.farmerId!==req.auth!.userId)return res.status(403).json({error:'Access denied'});return res.json({data:await prisma.nFCTag.update({where:{id:tag.id},data:{status:TagStatus.DEACTIVATED,deactivatedAt:new Date()}})})}));
router.patch('/nfc/:uid',authenticate,authorize(UserRole.FARMER,UserRole.ADMIN),asyncRoute(async(req,res)=>{const d=parse(z.object({uid:z.string().trim().min(3).max(128)}),req.body);const tag=await prisma.nFCTag.findUnique({where:{uid:req.params.uid.toUpperCase()},include:{crate:{include:{batch:true}}}});if(!tag)return res.status(404).json({error:'NFC tag not found'});if(req.auth!.role===UserRole.FARMER&&tag.crate?.batch.farmerId!==req.auth!.userId)return res.status(403).json({error:'Access denied'});return res.json({data:await prisma.nFCTag.update({where:{id:tag.id},data:{uid:d.uid.toUpperCase()}})})}));
router.get('/public/trace/:uid', asyncRoute(async (req, res) => {
  const tag = await prisma.nFCTag.findUnique({
    where: { uid: req.params.uid.toUpperCase() },
    include: { crate: { include: {
      batch: { include: {
        farmer: traceParty,
        // Purchase and transfer prices are private commercial data. The public
        // trace page only needs prices that retailers recorded for customers.
        prices: { where: { stage: PriceStage.CUSTOMER_SELLING }, orderBy: { createdAt: 'asc' } },
        shipments: { where: { status: ShipmentStatus.DELIVERED }, include: { retailer: traceParty } },
      } },
      readings: { orderBy: { recordedAt: 'asc' }, take: 500 },
      locations: { orderBy: { recordedAt: 'asc' }, take: 500 },
    } } },
  });
  if (!tag || tag.status !== TagStatus.ASSIGNED || !tag.crate) return res.status(404).json({ error: 'Trace record not found' });
  await prisma.scanHistory.create({ data: { tagId: tag.id, crateId: tag.crate.id } });
  const batch = tag.crate.batch;
  const crate = tag.crate;
  return res.json({ data: {
    tag: { uid: tag.uid, registeredAt: tag.registeredAt },
    crate: { crateCode: crate.crateCode, quantity: crate.quantity, weightKg: crate.weightKg, createdAt: crate.createdAt },
    batch: { batchCode: batch.batchCode, origin: batch.origin, quantity: batch.quantity, totalWeightKg: batch.totalWeightKg, status: batch.status, createdAt: batch.createdAt },
    farmer: batch.farmer ? { name: batch.farmer.name, farm: batch.farmer.farmer } : null,
    shipments: batch.shipments.map(s => ({ shipmentCode:s.shipmentCode,destination:s.destination,vehicle:s.vehicle,status:s.status,dispatchedAt:s.dispatchedAt,receivedAt:s.receivedAt,retailer:s.retailer ? {name:s.retailer.name,business:s.retailer.retailer} : null })),
    prices: batch.prices.map(p => ({stage:p.stage,amount:p.amount,currency:p.currency,createdAt:p.createdAt})),
    sensors: crate.readings.map(r=>({deviceId:r.deviceId,temperature:r.temperature,humidity:r.humidity,recordedAt:r.recordedAt})),
    gps: crate.locations.map(g=>({deviceId:g.deviceId,latitude:g.latitude,longitude:g.longitude,recordedAt:g.recordedAt})),
  } });
}));

router.post('/iot/readings',asyncRoute(async(req,res)=>{const provided=req.header('x-device-token')??'';const expected=process.env.IOT_INGEST_TOKEN??'';if(expected.length<32||expected.toLowerCase().includes('replace-with')||provided.length!==expected.length||!timingSafeEqual(createHash('sha256').update(provided).digest(),createHash('sha256').update(expected).digest()))return res.status(401).json({error:'Device authentication failed'});const d=parse(ingestSchema,req.body);if((d.latitude===undefined)!==(d.longitude===undefined))return res.status(400).json({error:'Latitude and longitude must be sent together'});const recordedAt=d.recordedAt?new Date(d.recordedAt):new Date();const result=await prisma.$transaction(async tx=>{const crate=await tx.crate.findUnique({where:{id:d.crateId}});if(!crate)throw Object.assign(new Error('Crate not found'),{status:404});const sensor= d.temperature!==undefined||d.humidity!==undefined?await tx.sensorReading.create({data:{deviceId:d.deviceId,crateId:d.crateId,temperature:d.temperature,humidity:d.humidity,recordedAt}}):null;const gps=d.latitude!==undefined?await tx.gPSLocation.create({data:{deviceId:d.deviceId,crateId:d.crateId,latitude:d.latitude!,longitude:d.longitude!,recordedAt}}):null;return {sensor,gps}});return res.status(201).json({data:result})}));
router.get('/crates/:crateId/readings',authenticate,asyncRoute(async(req,res)=>{const owner=await prisma.crate.findFirst({where:{id:req.params.crateId,...(req.auth!.role===UserRole.FARMER?{batch:{farmerId:req.auth!.userId}}:req.auth!.role===UserRole.RETAILER?{shipments:{some:{retailerId:req.auth!.userId}}}:{})}});if(!owner)return res.status(404).json({error:'Crate not found'});return res.json({data:await prisma.sensorReading.findMany({where:{crateId:owner.id},orderBy:{recordedAt:'desc'},take:1000})})}));
router.get('/crates/:crateId/readings/latest',authenticate,asyncRoute(async(req,res)=>{const owner=await prisma.crate.findFirst({where:{id:req.params.crateId,...(req.auth!.role===UserRole.FARMER?{batch:{farmerId:req.auth!.userId}}:req.auth!.role===UserRole.RETAILER?{shipments:{some:{retailerId:req.auth!.userId}}}:{})}});if(!owner)return res.status(404).json({error:'Crate not found'});return res.json({data:await prisma.sensorReading.findFirst({where:{crateId:owner.id},orderBy:{recordedAt:'desc'}})})}));
router.get('/crates/:crateId/location/latest',authenticate,asyncRoute(async(req,res)=>{const owner=await prisma.crate.findFirst({where:{id:req.params.crateId,...(req.auth!.role===UserRole.FARMER?{batch:{farmerId:req.auth!.userId}}:req.auth!.role===UserRole.RETAILER?{shipments:{some:{retailerId:req.auth!.userId}}}:{})}});if(!owner)return res.status(404).json({error:'Crate not found'});return res.json({data:await prisma.gPSLocation.findFirst({where:{crateId:owner.id},orderBy:{recordedAt:'desc'}})})}));

router.get('/admin/users',authenticate,authorize(UserRole.ADMIN),asyncRoute(async(_req,res)=>res.json({data:await prisma.user.findMany({select:{id:true,email:true,loginId:true,name:true,role:true,active:true,createdAt:true},orderBy:{createdAt:'desc'}})})));
router.post('/admin/users',authenticate,authorize(UserRole.ADMIN),asyncRoute(async(req,res)=>{const d=parse(z.object({email:z.string().email(),loginId:z.string().trim().min(3),name:z.string().trim().min(2),password:z.string().min(12),role:z.nativeEnum(UserRole),farmName:z.string().trim().min(2).optional(),businessName:z.string().trim().min(2).optional(),location:z.string().trim().min(2).optional()}),req.body);if(d.role===UserRole.FARMER&&(!d.farmName||!d.location))return res.status(400).json({error:'Farm name and location are required for farmer accounts'});if(d.role===UserRole.RETAILER&&(!d.businessName||!d.location))return res.status(400).json({error:'Business name and location are required for retailer accounts'});const user=await prisma.user.create({data:{email:d.email.toLowerCase(),loginId:d.loginId,name:d.name,passwordHash:await bcrypt.hash(d.password,12),role:d.role,...(d.role===UserRole.FARMER?{farmer:{create:{farmName:d.farmName!,location:d.location!}}}:d.role===UserRole.RETAILER?{retailer:{create:{businessName:d.businessName!,location:d.location!}}}:{})}});return res.status(201).json({data:{id:user.id,email:user.email,loginId:user.loginId,name:user.name,role:user.role,active:user.active}})}));
