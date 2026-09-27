import { createHmac, timingSafeEqual } from "node:crypto";

import type { Spec } from "@json-render/core";

import { catalog } from "~/lib/generative-catalog";

function signature(
  spec: unknown,
  scope: string,
  expiry: number,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(JSON.stringify([scope, expiry, spec]))
    .digest();
}

export function signSeed(
  spec: Spec,
  scope: string,
  secret: string,
  now = Date.now(),
): string {
  const expiry = now + 60 * 60 * 1000;
  return `${expiry}.${signature(spec, scope, expiry, secret).toString("base64url")}`;
}

export function verifySeed(
  spec: unknown,
  token: string | undefined,
  scope: string,
  secret: string,
  now = Date.now(),
): Spec {
  if (
    !token ||
    !spec ||
    typeof spec !== "object" ||
    JSON.stringify(spec).length > 40_000
  )
    throw new Error("Invalid initial spec");
  const match = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) throw new Error("Invalid initial spec");
  const expiry = Number(match[1]);
  if (expiry < now || expiry > now + 60 * 60 * 1000)
    throw new Error("Invalid initial spec");
  const actual = Buffer.from(match[2]!, "base64url");
  const expected = signature(spec, scope, expiry, secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("Invalid initial spec");
  const validated = catalog.validate(spec);
  if (!validated.success || !validated.data)
    throw new Error("Invalid initial spec");
  const seed = validated.data as Spec;
  if (
    !seed.root ||
    !seed.elements[seed.root] ||
    Object.keys(seed.elements).length > 24
  )
    throw new Error("Invalid initial spec");
  return seed;
}
