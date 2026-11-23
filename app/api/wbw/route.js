import { handle } from '../../../lib/http';
import { wbwConnectionApi } from '../../../lib/wbw-connection';
import * as db from '../../../lib/wbw';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const run = handle(req => wbwConnectionApi(req, db));
export const GET = run;
export const POST = run;
