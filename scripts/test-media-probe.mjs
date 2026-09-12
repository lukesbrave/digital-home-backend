import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
const source = await readFile(new URL('../src/lib/media/probe-image.ts', import.meta.url), 'utf8');
const png = Buffer.from(source.match(/MEDIA_PROBE_PNG_BASE64 = "([^"]+)"/)[1], 'base64');
function crc32(bytes) { let crc=0xffffffff; for (const byte of bytes) { crc^=byte; for(let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); } return (crc^0xffffffff)>>>0; }
assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
let offset=8, payload=[];
while(offset<png.length){const size=png.readUInt32BE(offset); const type=png.subarray(offset+4,offset+8);const data=png.subarray(offset+8,offset+8+size);assert.equal(crc32(Buffer.concat([type,data])),png.readUInt32BE(offset+8+size),`Invalid ${type} checksum`);if(type.toString()==='IDAT')payload.push(data);offset+=12+size;}
assert.equal(offset,png.length);
assert.equal(inflateSync(Buffer.concat(payload)).length,16*(1+16*3));
const {info}=await sharp(png).raw().toBuffer({resolveWithObject:true});assert.equal(info.width,16);assert.equal(info.height,16);assert.equal(info.channels,3);
const route=await readFile(new URL('../src/app/api/media/readiness/route.ts',import.meta.url),'utf8');assert.match(route,/atob\(MEDIA_PROBE_PNG_BASE64\)/);
console.log('PASS: actual setup fixture has valid PNG checksums, zlib data and raster decode; readiness uses that fixture.');
