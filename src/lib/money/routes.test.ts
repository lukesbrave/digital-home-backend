/**
 * The money routes' contract, read from their source the way
 * src/lib/home/agent-guide.test.ts reads the guide's: each handler checks the
 * scope the guide will name, Stripe-backed handlers answer 503 until money
 * is ready, and every path that wins a deal calls the shared hook.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function handler(file: string, method: string): string {
  const src = read(file);
  const start = src.indexOf(`export async function ${method}(`);
  assert.ok(start >= 0, `${file} exports ${method}`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

const SCOPED: Array<[string, string, string]> = [
  ["src/app/api/crm/products/route.ts", "GET", "money:read"],
  ["src/app/api/crm/products/route.ts", "POST", "money:write"],
  ["src/app/api/crm/products/route.ts", "PATCH", "money:write"],
  ["src/app/api/crm/orders/route.ts", "GET", "money:read"],
  ["src/app/api/crm/invoices/route.ts", "GET", "money:read"],
  ["src/app/api/crm/invoices/route.ts", "POST", "money:write"],
  ["src/app/api/crm/invoices/route.ts", "PATCH", "money:write"],
  ["src/app/api/crm/engagements/route.ts", "GET", "money:read"],
  ["src/app/api/crm/engagements/route.ts", "POST", "money:write"],
  ["src/app/api/crm/engagements/route.ts", "PATCH", "money:write"],
  ["src/app/api/crm/engagements/from-deal/route.ts", "POST", "money:write"],
  ["src/app/api/crm/engagements/[id]/deliverables/route.ts", "GET", "money:read"],
  ["src/app/api/crm/engagements/[id]/deliverables/route.ts", "POST", "money:write"],
  ["src/app/api/crm/engagements/[id]/deliverables/route.ts", "PATCH", "money:write"],
];

test("every money handler authenticates, then requires its scope before touching data", () => {
  for (const [file, method, scope] of SCOPED) {
    const src = handler(file, method);
    const auth = src.indexOf("authenticateSessionOrApiKey(request)");
    const gate = src.indexOf(`requireScope(auth, "${scope}")`);
    const data = src.search(/moneyDb\(|createAdminClient\(/);
    assert.ok(auth >= 0, `${method} ${file}: no auth`);
    assert.ok(gate > auth, `${method} ${file}: no ${scope} check`);
    assert.ok(data < 0 || data > gate, `${method} ${file}: reads data before the scope check`);
    assert.ok(!/requireScope\(auth, "money:checkout"\)/.test(src), `${method} ${file}: money:checkout is checkout-only`);
  }
});

test("checkout takes the narrow money:checkout scope or money:write, and nothing else", () => {
  const src = handler("src/app/api/crm/checkout/route.ts", "POST");
  assert.match(src, /const denied = requireScope\(auth, "money:checkout"\);\n\s*if \(denied && requireScope\(auth, "money:write"\)\) return denied;/);
});

test("checkout and sending invoices answer 503 until both Stripe secrets are set", () => {
  const checkout = handler("src/app/api/crm/checkout/route.ts", "POST");
  assert.ok(checkout.indexOf("isMoneyReady()") > 0 && checkout.indexOf("isMoneyReady()") < checkout.indexOf("moneyDb("), "checkout checks before any write");
  assert.match(handler("src/app/api/crm/invoices/route.ts", "POST"), /if \(send && !isMoneyReady\(\)\) return NextResponse\.json\(\{ error: NOT_CONFIGURED \}, \{ status: 503 \}\)/);
  assert.match(handler("src/app/api/crm/invoices/route.ts", "PATCH"), /if \(!isMoneyReady\(\)\) return NextResponse\.json\(\{ error: NOT_CONFIGURED \}, \{ status: 503 \}\)/);
});

test("the Stripe webhook and the public product list take no API key", () => {
  const webhook = handler("src/app/api/webhooks/stripe/route.ts", "POST");
  assert.match(webhook, /handleStripeWebhook\(/);
  assert.ok(!webhook.includes("authenticateSessionOrApiKey"));
  const pub = handler("src/app/api/public/products/route.ts", "GET");
  assert.ok(!pub.includes("authenticateSessionOrApiKey"));
  assert.ok(!/stripe_price_id|stripe_product_id|metadata/.test(pub.split("select(")[1].split(")")[0]), "no Stripe ids or metadata in public rows");
});

test("every path that wins a deal calls the shared won hook", () => {
  const patch = handler("src/app/api/crm/opportunities/[id]/route.ts", "PATCH");
  assert.match(patch, /if \(isDealWon\(\{ status: statusChange, stageName: movedStage\?\.name \}\)\) await onDealWon\(/);

});

test("every path that can win a deal calls the hook: engine, workflow step, deal creation", () => {
  const engine = read("src/lib/crm/engine.ts");
  assert.equal((engine.match(/isDealWon\(\{ stageName: target\.name \}\)\) await onDealWon\(/g) || []).length, 2, "ensureLeadOpportunity advance and create");
  assert.match(engine, /if \(opportunityId && isDealWon\(\{ stageName: stage\.name \}\)\) await onDealWon\(/);
  assert.match(handler("src/app/api/crm/opportunities/route.ts", "POST"), /if \(isDealWon\(\{ stageName: stage\.name \}\)\) await onDealWon\(/);

});

test("voiding an invoice goes through cancelInvoice and only from the status read", () => {
  const patch = handler("src/app/api/crm/invoices/route.ts", "PATCH");
  assert.match(patch, /cancelInvoice\(invoice\.stripe_invoice_id\)/);
  assert.ok(!/voidInvoice\(/.test(patch));
  assert.match(patch, /\.update\(\{ status: "void" \}\)\s*\.eq\("id", invoice\.id\)\s*\.eq\("status", invoice\.status\)/);
});
