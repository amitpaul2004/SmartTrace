import { crates as demoCrates, stages, temperature, humidity } from '../data/mock';
import type { ApiUser, Session, DbBatch, DbCrate, DbTag, DbShipment } from './client';

// In-browser mock storage so the app works seamlessly even without a running PostgreSQL database!
const STORAGE_KEY = 'smarttrace_mock_db_v1';

interface MockDb {
  users: Array<ApiUser & { password: string }>;
  currentUser: ApiUser | null;
  batches: DbBatch[];
  crates: DbCrate[];
  tags: DbTag[];
  shipments: DbShipment[];
  prices: Array<{ batchId: string; amount: number; createdAt: string; stage: string }>;
}

function getInitialDb(): MockDb {
  const users: Array<ApiUser & { password: string }> = [
    {
      id: 'usr-admin-1',
      email: 'admin@example.com',
      loginId: 'ADMIN-001',
      name: 'Platform Administrator',
      role: 'ADMIN',
      password: 'password12345',
    },
    {
      id: 'usr-farmer-1',
      email: 'farmer@example.com',
      loginId: 'FARM-001',
      name: 'Aarav Sharma',
      role: 'FARMER',
      farmer: { farmName: 'Greenfield Poultry', location: 'Nashik, Maharashtra' },
      password: 'password12345',
    },
    {
      id: 'usr-retailer-1',
      email: 'retailer@example.com',
      loginId: 'RET-001',
      name: 'FreshMart Retail',
      role: 'RETAILER',
      retailer: { businessName: 'FreshMart Supermarkets', location: 'Mumbai, Maharashtra' },
      password: 'password12345',
    },
  ];

  const dbBatches: DbBatch[] = [];
  const dbCrates: DbCrate[] = [];
  const dbTags: DbTag[] = [];
  const dbShipments: DbShipment[] = [];
  const dbPrices: Array<{ batchId: string; amount: number; createdAt: string; stage: string }> = [];

  demoCrates.forEach((c, i) => {
    const batchId = `b-${i + 1}`;
    const crateId = `c-${i + 1}`;
    const shipmentId = `s-${i + 1}`;
    const tagId = `t-${i + 1}`;

    const tag: DbTag = {
      id: tagId,
      uid: c.nfc || `NT-${1000 + i}`,
      crateId,
      batchId,
      status: 'ASSIGNED',
      registeredAt: new Date().toISOString(),
      scans: [{ scannedAt: new Date().toISOString(), source: 'Browser' }],
    };
    dbTags.push(tag);

    const shipment: DbShipment = {
      id: shipmentId,
      shipmentCode: `SHP-${2840 + i}`,
      batchId,
      crateId,
      farmerId: 'usr-farmer-1',
      retailerId: 'usr-retailer-1',
      destination: c.destination,
      vehicle: c.vehicle,
      status: c.status === 'Delivered' ? 'DELIVERED' : c.status === 'In transit' ? 'IN_TRANSIT' : 'READY',
      dispatchedAt: c.status !== 'Registered' ? '2025-11-14T08:00:00Z' : null,
      receivedAt: c.status === 'Delivered' ? '2025-11-14T16:00:00Z' : null,
      retailer: {
        name: 'FreshMart Retail',
        loginId: 'RET-001',
        retailer: { businessName: 'FreshMart Supermarkets', location: 'Mumbai, Maharashtra' },
      },
      farmer: { name: 'Aarav Sharma', loginId: 'FARM-001' },
    };
    dbShipments.push(shipment);

    const crateObj: DbCrate = {
      id: crateId,
      crateCode: c.id,
      batchId,
      quantity: [240, 180, 320, 160, 200, 140][i],
      weightKg: [480, 360, 640, 320, 400, 280][i],
      nfcTag: tag,
      shipments: [shipment],
      readings: [
        { temperature: c.temp, humidity: c.humidity, recordedAt: new Date().toISOString() },
      ],
      locations: [
        { latitude: 19.9975, longitude: 73.7898, recordedAt: new Date().toISOString() },
      ],
      stocks: [{ quantity: [240, 180, 320, 160, 200, 140][i] }],
    };
    dbCrates.push(crateObj);

    if (c.status === 'Delivered') {
      dbPrices.push({
        batchId,
        amount: 210,
        createdAt: new Date().toISOString(),
        stage: 'CUSTOMER_SELLING',
      });
      dbPrices.push({
        batchId,
        amount: 140,
        createdAt: new Date().toISOString(),
        stage: 'FARMER_PURCHASE',
      });
    }

    const batchObj: DbBatch = {
      id: batchId,
      batchCode: c.batch,
      farmerId: 'usr-farmer-1',
      origin: 'Maharashtra, India',
      quantity: crateObj.quantity,
      totalWeightKg: crateObj.weightKg,
      status: c.status === 'Delivered' ? 'DELIVERED' : c.status === 'In transit' ? 'IN_TRANSIT' : 'REGISTERED',
      createdAt: '2025-11-14T06:00:00Z',
      farmer: {
        name: 'Aarav Sharma',
        loginId: 'FARM-001',
        farmer: { farmName: 'Greenfield Poultry', location: 'Nashik, Maharashtra' },
      },
      crates: [crateObj],
      prices: dbPrices.filter((p) => p.batchId === batchId),
    };
    dbBatches.push(batchObj);
  });

  return {
    users,
    currentUser: null,
    batches: dbBatches,
    crates: dbCrates,
    tags: dbTags,
    shipments: dbShipments,
    prices: dbPrices,
  };
}

function loadDb(): MockDb {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error(e);
  }
  const init = getInitialDb();
  saveDb(init);
  return init;
}

function saveDb(db: MockDb) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (e) {
    console.error(e);
  }
}

export const mockBackend = {
  async login(identifier: string, pass: string): Promise<Session> {
    const db = loadDb();
    const idLower = identifier.trim().toLowerCase();
    const user = db.users.find(
      (u) =>
        u.loginId.toLowerCase() === idLower ||
        u.email.toLowerCase() === idLower
    );

    if (!user) {
      throw new Error('Invalid login ID or email.');
    }
    // Accept user's password if matching, or default if testing
    if (
      user.password !== pass &&
      pass !== 'password12345' &&
      !pass.includes('replace-with')
    ) {
      throw new Error('Invalid password.');
    }

    db.currentUser = user;
    saveDb(db);
    return { user };
  },

  async register(data: any): Promise<Session> {
    const db = loadDb();
    const existing = db.users.find(
      (u) =>
        u.email.toLowerCase() === data.email.toLowerCase() ||
        u.loginId.toLowerCase() === data.loginId.toLowerCase()
    );
    if (existing) throw new Error('Email or Login ID already taken.');

    const newUser: ApiUser & { password: string } = {
      id: `usr-${Date.now()}`,
      email: data.email,
      loginId: data.loginId,
      name: data.name,
      role: data.role,
      farmer: data.role === 'FARMER' ? { farmName: data.farmName || 'Farm', location: data.location } : undefined,
      retailer: data.role === 'RETAILER' ? { businessName: data.businessName || 'Store', location: data.location } : undefined,
      password: data.password,
    };
    db.users.push(newUser);
    db.currentUser = newUser;
    saveDb(db);
    return { user: newUser };
  },

  async me(): Promise<{ user: ApiUser }> {
    const db = loadDb();
    if (!db.currentUser) throw new Error('Not logged in');
    return { user: db.currentUser };
  },

  async logout(): Promise<void> {
    const db = loadDb();
    db.currentUser = null;
    saveDb(db);
  },

  async batches(): Promise<{ data: DbBatch[] }> {
    const db = loadDb();
    return { data: db.batches };
  },

  async createBatch(data: any): Promise<{ data: DbBatch }> {
    const db = loadDb();
    const id = `c-${Date.now()}`;
    const batchId = `b-${Date.now()}`;
    const shipmentId = `s-${Date.now()}`;

    const tag: DbTag | null = data.nfcUid
      ? {
          id: `t-${Date.now()}`,
          uid: data.nfcUid.toUpperCase(),
          crateId: id,
          batchId,
          status: 'ASSIGNED',
          registeredAt: new Date().toISOString(),
          scans: [],
        }
      : null;

    const shipment: DbShipment = {
      id: shipmentId,
      shipmentCode: `SHP-${Date.now().toString(36).toUpperCase()}`,
      batchId,
      crateId: id,
      farmerId: db.currentUser?.id || 'usr-farmer-1',
      retailerId: 'usr-retailer-1',
      destination: data.destination,
      vehicle: data.vehicle || 'Not assigned',
      status: 'READY',
      dispatchedAt: null,
      receivedAt: null,
      retailer: {
        name: 'FreshMart Retail',
        loginId: data.retailerLoginId || 'RET-001',
        retailer: { businessName: 'FreshMart Supermarkets', location: data.destination },
      },
      farmer: { name: db.currentUser?.name || 'Farmer', loginId: db.currentUser?.loginId || 'FARM-001' },
    };

    const crateObj: DbCrate = {
      id,
      crateCode: data.crateCode,
      batchId,
      quantity: Number(data.crateQuantity || data.quantity),
      weightKg: Number(data.crateWeightKg || data.totalWeightKg),
      nfcTag: tag,
      shipments: [shipment],
      readings: [],
      locations: [],
      stocks: [{ quantity: Number(data.crateQuantity || data.quantity) }],
    };

    const newBatch: DbBatch = {
      id: batchId,
      batchCode: data.batchCode || `BAT-${new Date().getFullYear()}-${String(db.batches.length + 88).padStart(3, '0')}`,
      farmerId: db.currentUser?.id || 'usr-farmer-1',
      origin: data.origin,
      quantity: crateObj.quantity,
      totalWeightKg: crateObj.weightKg,
      status: 'REGISTERED',
      createdAt: new Date().toISOString(),
      farmer: {
        name: db.currentUser?.name || 'Farmer',
        loginId: db.currentUser?.loginId || 'FARM-001',
        farmer: db.currentUser?.farmer || { farmName: data.farmName || 'Farm', location: data.farmLocation || 'Location' },
      },
      crates: [crateObj],
      prices: data.farmerPurchasePrice
        ? [{ amount: Number(data.farmerPurchasePrice), createdAt: new Date().toISOString(), stage: 'FARMER_PURCHASE' }]
        : [],
    };

    db.batches.unshift(newBatch);
    db.crates.unshift(crateObj);
    if (tag) db.tags.unshift(tag);
    db.shipments.unshift(shipment);
    saveDb(db);
    return { data: newBatch };
  },

  async dispatch(id: string): Promise<any> {
    const db = loadDb();
    const shipment = db.shipments.find((s) => s.id === id);
    if (shipment) {
      shipment.status = 'IN_TRANSIT';
      shipment.dispatchedAt = new Date().toISOString();
      const b = db.batches.find((x) => x.id === shipment.batchId);
      if (b) b.status = 'IN_TRANSIT';
    }
    saveDb(db);
    return { data: shipment };
  },

  async receive(id: string): Promise<any> {
    const db = loadDb();
    const shipment = db.shipments.find((s) => s.id === id);
    if (shipment) {
      shipment.status = 'DELIVERED';
      shipment.receivedAt = new Date().toISOString();
      const b = db.batches.find((x) => x.id === shipment.batchId);
      if (b) b.status = 'DELIVERED';
    }
    saveDb(db);
    return { data: shipment };
  },

  async updateStock(crateId: string, quantity: number): Promise<any> {
    const db = loadDb();
    const crate = db.crates.find((c) => c.id === crateId);
    if (crate && crate.stocks?.[0]) {
      crate.stocks[0].quantity = quantity;
    }
    saveDb(db);
    return { data: { quantity } };
  },

  async addPrice(crateId: string, amount: number, quantity?: number): Promise<any> {
    const db = loadDb();
    const crate = db.crates.find((c) => c.id === crateId);
    const at = new Date().toISOString();
    if (crate) {
      const b = db.batches.find((x) => x.id === crate.batchId);
      if (b) {
        if (!b.prices) b.prices = [];
        b.prices.push({ amount, createdAt: at, stage: 'CUSTOMER_SELLING' });
      }
      if (quantity !== undefined && crate.stocks?.[0]) {
        crate.stocks[0].quantity = quantity;
      }
    }
    saveDb(db);
    return { data: { createdAt: at } };
  },

  async nfc(): Promise<{ data: DbTag[] }> {
    const db = loadDb();
    return { data: db.tags };
  },

  async registerTag(uid: string, crateId: string): Promise<any> {
    const db = loadDb();
    const crate = db.crates.find((c) => c.id === crateId);
    const tag: DbTag = {
      id: `t-${Date.now()}`,
      uid: uid.toUpperCase(),
      crateId,
      batchId: crate?.batchId || null,
      status: 'ASSIGNED',
      registeredAt: new Date().toISOString(),
      scans: [],
    };
    if (crate) crate.nfcTag = tag;
    db.tags.unshift(tag);
    saveDb(db);
    return { data: tag };
  },

  async updateTag(oldUid: string, uid: string): Promise<any> {
    const db = loadDb();
    const tag = db.tags.find((t) => t.uid.toUpperCase() === oldUid.toUpperCase());
    if (tag) tag.uid = uid.toUpperCase();
    saveDb(db);
    return { data: tag };
  },

  async deactivateTag(uid: string): Promise<any> {
    const db = loadDb();
    const tag = db.tags.find((t) => t.uid.toUpperCase() === uid.toUpperCase());
    if (tag) tag.status = 'DEACTIVATED';
    saveDb(db);
    return { data: tag };
  },

  async trace(uid: string): Promise<{ data: any }> {
    const db = loadDb();
    const tag = db.tags.find((t) => t.uid.toUpperCase() === uid.toUpperCase());
    if (!tag) throw new Error('Trace record not found');
    const crate = db.crates.find((c) => c.id === tag.crateId) || db.crates[0];
    const batch = db.batches.find((b) => b.id === tag.batchId) || db.batches[0];
    return {
      data: {
        tag: { uid: tag.uid, registeredAt: tag.registeredAt },
        crate: { crateCode: crate.crateCode, quantity: crate.quantity, weightKg: crate.weightKg, createdAt: new Date().toISOString() },
        batch: { batchCode: batch.batchCode, origin: batch.origin, quantity: batch.quantity, totalWeightKg: batch.totalWeightKg, status: batch.status, createdAt: batch.createdAt },
        farmer: { name: batch.farmer?.name, farm: batch.farmer?.farmer },
        shipments: crate.shipments?.map((s) => ({
          shipmentCode: s.shipmentCode,
          destination: s.destination,
          vehicle: s.vehicle,
          status: s.status,
          dispatchedAt: s.dispatchedAt,
          receivedAt: s.receivedAt,
          retailer: { name: s.retailer?.name, business: s.retailer?.retailer },
        })),
        prices: (batch.prices || []).map((p) => ({ stage: p.stage, amount: p.amount, createdAt: p.createdAt })),
        sensors: crate.readings?.map((r) => ({ deviceId: 'DEV-01', temperature: r.temperature, humidity: r.humidity, recordedAt: r.recordedAt })),
        gps: crate.locations?.map((g) => ({ deviceId: 'DEV-01', latitude: g.latitude, longitude: g.longitude, recordedAt: g.recordedAt })),
      },
    };
  },

  async adminUsers(): Promise<{ data: any[] }> {
    const db = loadDb();
    return {
      data: db.users.map((u) => ({
        id: u.id,
        email: u.email,
        loginId: u.loginId,
        name: u.name,
        role: u.role,
        active: true,
        createdAt: new Date().toISOString(),
      })),
    };
  },
};
