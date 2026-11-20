import { BadRequestException, ConflictException, HttpException, InternalServerErrorException, NotFoundException } from '@nestjs/common';

// Loosely typed on purpose: the project has no generated Supabase DB types.
type Res = { data: any; error: { message: string; code?: string } | null };

function mapMessage(msg: string): HttpException | null {
  if (msg.includes('REQUEST_NOT_FOUND') || msg.includes('LOAN_NOT_FOUND')) return new NotFoundException(msg);
  if (msg.includes('REQUEST_NOT_PENDING') || msg.includes('LOAN_ALREADY_RETURNED') || msg.includes('INSUFFICIENT_STOCK') || msg.includes('PENDING_LIMIT_REACHED'))
    return new ConflictException(msg.replace(/^.*?(REQUEST_|LOAN_|INSUFFICIENT_|PENDING_)/, '$1'));
  if (msg.includes('INVALID_')) return new BadRequestException(msg);
  return null;
}

/** Unwraps a Supabase result, translating DB / business-rule errors into HTTP errors. */
export function unwrap(res: Res): any {
  if (res.error) {
    const mapped = mapMessage(res.error.message);
    if (mapped) throw mapped;
    if (res.error.code === '23505') throw new ConflictException('Duplicate value violates a unique constraint');
    if (res.error.code === '23503') throw new BadRequestException('Referenced record does not exist or is still in use');
    if (res.error.code === '23514' || res.error.code === '22P02') throw new BadRequestException('Invalid value');
    console.error('[db]', res.error);
    throw new InternalServerErrorException('Database error');
  }
  return res.data;
}

/** Like unwrap, but throws 404 when nothing was found. */
export function unwrapOne(res: Res, what = 'Record'): any {
  const data = unwrap(res);
  if (data === null || data === undefined) throw new NotFoundException(`${what} not found`);
  return data;
}
