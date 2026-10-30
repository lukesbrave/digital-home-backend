import {NextRequest,NextResponse} from 'next/server';
import {authenticateSessionOrApiKey,unauthorizedResponse} from '@/lib/api/auth';
import {HOME_GUIDE} from '@/lib/home/contract';
export async function GET(request:NextRequest){const auth=await authenticateSessionOrApiKey(request);if(!auth.authenticated)return unauthorizedResponse(auth.error);return NextResponse.json(HOME_GUIDE,{headers:{'Cache-Control':'no-store'}});}
