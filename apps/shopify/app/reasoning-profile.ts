// Browser-safe identifiers only. Credentials remain in server modules.
export function splitReasoningProfile(value: string) {
  const parts = value.split("|plus=");
  return { chat: parts[0], plus: parts.length === 1 ? "default" : parts[1], valid: parts.length <= 2 };
}

export function combineReasoningProfile(chat: string, plus: string) {
  return plus === "default" ? chat : `${chat}|plus=${plus}`;
}

