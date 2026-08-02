export async function isBearerTokenAuthorized(
  request: Request,
  configuredToken: string | undefined,
): Promise<boolean> {
  const token = configuredToken?.trim();
  const authorization = request.headers.get("Authorization");
  if (!token || !authorization) {
    return false;
  }

  const encoder = new TextEncoder();
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(authorization)),
    crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${token}`)),
  ]);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (left: BufferSource, right: BufferSource) => boolean;
  };
  return subtle.timingSafeEqual
    ? subtle.timingSafeEqual(actual, expected)
    : constantTimeEqual(new Uint8Array(actual), new Uint8Array(expected));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}
