/** PostgreSQL's uuid input accepts any canonical 8-4-4-4-12 hex value. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

export function validUuidValues(values: string[] | null | undefined): string[] {
  return Array.from(
    new Set((values ?? []).map((value) => value.trim()).filter((value) => isUuid(value)))
  );
}
