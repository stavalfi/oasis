import { z } from "zod";

const PortSchema = z.coerce.number().int().min(1).max(65_535);

export class PortParser {
  public static parse(v: string): number {
    return PortSchema.parse(v);
  }
}
