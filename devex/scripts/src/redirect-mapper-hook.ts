/**
 * Redirect outbound connections via a from→to map.
 *
 * Preload: NODEJS_REDIRECT_MAPPING_FILE_PATH=mapping.json node --import ./redirect-mapper-hook.ts app.ts
 *
 * Reads the mapping file and builds redirect rules from each service's
 * `redirects.dns` and `redirects.ip` entries. DNS redirects patch
 * `dns.lookup`; IP redirects patch `net.Socket.connect`.
 */

/* eslint-disable promise/prefer-await-to-callbacks */

import dns from "node:dns";
import { readFile } from "node:fs/promises";
import net from "node:net";

interface Redirect {
  from: { host: string };
  to: { host: string };
}

interface Service {
  redirects?: {
    dns: Redirect[];
    ip: Redirect[];
  };
}

interface MappingFile {
  services: Record<string, Service>;
}

type LookupCallback = (
  err: Error | undefined,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

class RedirectMapperHook {
  public static isObjectWithAll(value: unknown): value is { all?: boolean } {
    if (!value || typeof value !== "object") {
      return false;
    }
    if (!("all" in value)) {
      return true;
    }
    return typeof value.all === "boolean" || value.all === undefined;
  }

  public static isObjectWithHost(value: unknown): value is { host: string } {
    if (!value || typeof value !== "object") {
      return false;
    }
    if (!("host" in value)) {
      return false;
    }
    return typeof value.host === "string";
  }

  public static install(allRules: Record<string, string>): void {
    const origLookup = dns.lookup;

    // eslint-disable-next-line poc-rules/require-object-params
    const patchedLookup = function patchedLookup(
      hostname: string,
      optionsOrCallback?: unknown,
      callback?: LookupCallback,
    ): void {
      let args: unknown = optionsOrCallback;
      let cb: unknown = callback;
      if (typeof args === "function") {
        cb = args;
        args = undefined;
      }
      // eslint-disable-next-line poc-rules/require-object-params
      const invokeCb = (
        err: Error | undefined,
        address: string | { address: string; family: number }[],
        family?: number,
      ): void => {
        if (typeof cb === "function") {
          Reflect.apply(cb, undefined, [err, address, family]);
        }
      };
      const lookupTarget = allRules[hostname];
      if (lookupTarget !== undefined) {
        if (RedirectMapperHook.isObjectWithAll(args) && args.all === true) {
          invokeCb(undefined, [{ address: lookupTarget, family: 4 }]);
          return;
        }
        invokeCb(undefined, lookupTarget, 4);
        return;
      }
      Reflect.apply(origLookup, dns, [hostname, args, cb]);
    };

    Object.defineProperty(dns, "lookup", {
      configurable: true,
      value: patchedLookup,
      writable: true,
    });

    const origConnect = net.Socket.prototype.connect;

    // eslint-disable-next-line poc-rules/require-object-params
    const patchedConnect = function patchedConnect(
      this: net.Socket,
      ...args: unknown[]
    ): net.Socket {
      const [options] = args;
      if (RedirectMapperHook.isObjectWithHost(options)) {
        const target = allRules[options.host];
        if (target !== undefined) {
          options.host = target;
        }
      }
      return Reflect.apply(origConnect, this, args);
    };

    Object.defineProperty(net.Socket.prototype, "connect", {
      configurable: true,
      value: patchedConnect,
      writable: true,
    });
  }
}

const MAPPING_PATH_ENV = "NODEJS_REDIRECT_MAPPING_FILE_PATH";
const mappingPath = process.env[MAPPING_PATH_ENV];
if (!mappingPath) {
  throw new Error(`${MAPPING_PATH_ENV} is not set — point it at the JSON mapping file`);
}

const file: MappingFile = JSON.parse(await readFile(mappingPath, "utf8"));

const dnsRules: Record<string, string> = {};
const ipRules: Record<string, string> = {};

for (const svc of Object.values(file.services)) {
  if (svc.redirects) {
    for (const r of svc.redirects.dns) {
      dnsRules[r.from.host] = r.to.host;
    }
    for (const r of svc.redirects.ip) {
      ipRules[r.from.host] = r.to.host;
    }
  }
}

RedirectMapperHook.install({ ...dnsRules, ...ipRules });
