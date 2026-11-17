export interface ApiUser { id:string; email:string; loginId:string; name:string; role:'FARMER'|'RETAILER'|'ADMIN'; farmer?:{farmName:string;location:string}|null; retailer?:{businessName:string;location:string}|null }
export interface Session { user:ApiUser }
export interface ApiError extends Error { status:number }
const base='/api';
let authenticated=false;
export const sessionToken=()=>authenticated?'cookie-session':null;
export const setSessionToken=(value:string|null)=>{authenticated=Boolean(value)};

async function request<T>(path:string, options:RequestInit={}):Promise<T>{
  const response=await fetch(`${base}${path}`,{...options,credentials:'include',headers:{'Content-Type':'application/json',...options.headers}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const details=Array.isArray(body.details)?body.details.map((x:{field?:string;message?:string})=>`${x.field?`${x.field}: `:''}${x.message??''}`).filter(Boolean).join('; '):'';
    const error=new Error([body.error,details].filter(Boolean).join(': ')||`Request failed (${response.status})`) as ApiError;
    error.status=response.status;
    throw error;
  }
  return body as T;
}

export const api={
  async login(identifier:string,password:string){
    const result=await request<Session>('/auth/login',{method:'POST',body:JSON.stringify({identifier,password})});
    setSessionToken('cookie');
    return result;
  },
  async register(data:Record<string,unknown>){
    const result=await request<Session>('/auth/register',{method:'POST',body:JSON.stringify(data)});
    setSessionToken('cookie');
    return result;
  },
  me:async()=>{const result=await request<{user:ApiUser}>('/auth/me');setSessionToken('cookie');return result},
  logout:async()=>{try{await request('/auth/logout',{method:'POST'})}finally{setSessionToken(null)}},
  batches:()=>request<{data:DbBatch[]}>('/batches'),
  retailers:()=>request<{data:{id:string;loginId:string;name:string;retailer?:{businessName:string;location:string}|null}[]}>('/retailers'),
  createBatch:(data:Record<string,unknown>)=>request<{data:DbBatch}>('/batches',{method:'POST',body:JSON.stringify(data)}),
  crates:()=>request<{data:DbCrate[]}>('/crates'),
  shipments:()=>request<{data:DbShipment[]}>('/shipments'),
  createShipment:(data:Record<string,unknown>)=>request<{data:DbShipment}>('/shipments',{method:'POST',body:JSON.stringify(data)}),
  dispatch:(id:string)=>request(`/shipments/${id}/dispatch`,{method:'POST'}),
  receive:(id:string)=>request(`/shipments/${id}/receive`,{method:'POST'}),
  nfc:()=>request<{data:DbTag[]}>('/nfc'),
  registerTag:(uid:string,crateId:string)=>request('/nfc',{method:'POST',body:JSON.stringify({uid,crateId})}),
  updateTag:(oldUid:string,uid:string)=>request(`/nfc/${encodeURIComponent(oldUid)}`,{method:'PATCH',body:JSON.stringify({uid})}),
  deactivateTag:(uid:string)=>request(`/nfc/${encodeURIComponent(uid)}/deactivate`,{method:'PATCH'}),
  updateStock:(crateId:string,quantity:number)=>request(`/crates/${crateId}/stock`,{method:'PATCH',body:JSON.stringify({quantity})}),
  addPrice:(crateId:string,amount:number,quantity?:number)=>request(`/crates/${crateId}/prices`,{method:'POST',body:JSON.stringify({amount,...(quantity!==undefined?{quantity}:{})})}),
  trace:(uid:string)=>request<{data:unknown}>(`/public/trace/${encodeURIComponent(uid)}`),
  readings:(crateId:string)=>request(`/crates/${crateId}/readings`),
  latestReading:(crateId:string)=>request(`/crates/${crateId}/readings/latest`),
  location:(crateId:string)=>request(`/crates/${crateId}/location/latest`),
  adminUsers:()=>request<{data:{id:string;email:string;loginId:string;name:string;role:string;active:boolean;createdAt:string}[]}>('/admin/users'),
  updateFarmerProfile:(data:{farmName:string;location:string})=>request<{data:{farmName:string;location:string}}>('/profile',{method:'PATCH',body:JSON.stringify(data)}),
};

export interface DbBatch { id:string;batchCode:string;farmerId:string;origin:string;quantity:number;totalWeightKg:number|string;status:string;createdAt:string;farmer?:{name:string;loginId:string;farmer?:{farmName:string;location:string}};crates:DbCrate[];prices?:{amount:number|string;createdAt:string;stage:string}[] }
export interface DbCrate { id:string;crateCode:string;batchId:string;quantity:number;weightKg:number|string;nfcTag?:DbTag|null;shipments?:DbShipment[];readings?:{temperature:number|null;humidity:number|null;recordedAt:string}[];locations?:{latitude:number|string;longitude:number|string;recordedAt:string}[];stocks?:{quantity:number}[] }
export interface DbTag { id:string;uid:string;crateId:string|null;batchId:string|null;status:string;registeredAt:string;crate?:DbCrate|null;scans?:{scannedAt:string;source:string}[] }
export interface DbShipment { id:string;shipmentCode:string;batchId:string;crateId:string;farmerId:string;retailerId:string;destination:string;vehicle:string|null;status:string;dispatchedAt:string|null;receivedAt:string|null;batch?:DbBatch;crate?:DbCrate;farmer?:{name:string;loginId:string};retailer?:{name:string;loginId:string;retailer?:{businessName:string;location:string}} }

export function toFrontendBatch(batch:DbBatch, crate:DbCrate) {
  const shipment = crate.shipments?.[0];
  const locations=[...(crate.locations??[])].reverse();
  const retailer = shipment?.retailer?.retailer?.businessName ?? shipment?.retailer?.name ?? shipment?.retailerId ?? 'Retailer pending';
  // A batch can contain several crates with separate shipments. Once a crate
  // has a shipment, its state must come from that shipment rather than the
  // aggregate batch status (which may reflect another crate).
  const currentStatus = shipment?.status ?? batch.status;
  const status = currentStatus === 'DELIVERED' ? 'Delivered' : currentStatus === 'IN_TRANSIT' ? 'In transit' : 'Registered';
  const priceRecords = (batch.prices??[]).filter(p=>p.stage==='CUSTOMER_SELLING').map(p=>({value:Number(p.amount),at:p.createdAt}));
  return {
    id:crate.crateCode,batch:batch.batchCode,farm:`${batch.farmer?.farmer?.farmName??batch.farmer?.name??'Farm'}, ${batch.farmer?.farmer?.location??''}`.replace(/,\s*$/,''),
    destination:shipment?.destination??'Not dispatched',retailer,nfc:crate.nfcTag?.uid??'',nfcActive:crate.nfcTag?.status!=='DEACTIVATED',
    status,temp:0,humidity:0,device:'Not connected',updated:shipment?.dispatchedAt??batch.createdAt,vehicle:shipment?.vehicle??'Not dispatched',progress:status==='Delivered'?100:status==='In transit'?50:0,
    quantity:crate.stocks?.[0]?.quantity??crate.quantity,weight:Number(crate.weightKg),origin:batch.origin,farmer:batch.farmer?.farmer?.farmName??batch.farmer?.name??'Farmer',dispatchDate:shipment?.dispatchedAt??'Not dispatched',received:status==='Delivered',
    price:priceRecords.at(-1)?.value??null,purchasePrice:(batch.prices??[]).find(p=>p.stage==='FARMER_PURCHASE')?Number((batch.prices??[]).find(p=>p.stage==='FARMER_PURCHASE')!.amount):null,prices:priceRecords,nfcScans:crate.nfcTag?.scans?.map(x=>({at:x.scannedAt,source:x.source}))??[],
    readings:[...(crate.readings??[])].reverse().map((x,i)=>({time:new Date(x.recordedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),temp:Number(x.temperature??0),humidity:Number(x.humidity??0),lat:Number(locations[i]?.latitude??0),lng:Number(locations[i]?.longitude??0)})),history:[`Batch ${batch.status.toLowerCase().replaceAll('_',' ')}`,...(shipment?[`Shipment ${shipment.status.toLowerCase().replaceAll('_',' ')}`]:[])],
    gps:locations.map(g=>({lat:Number(g.latitude),lng:Number(g.longitude),time:g.recordedAt})),
    backendId:crate.id,backendBatchId:batch.id,backendShipmentId:shipment?.id,retailerLoginId:shipment?.retailer?.loginId,
  };
}
