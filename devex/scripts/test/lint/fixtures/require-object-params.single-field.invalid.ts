// @ts-nocheck
export class Foo {
  public static getProjects({ userId }: { userId: string }): void {}
  public method({ id }: { id: string }): void {}
}

export function namedFn({ id }: { id: string }): void {}

export const arrowFn = ({ id }: { id: string }): void => {};
