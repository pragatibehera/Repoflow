"use client";

import { ClerkProvider } from "@clerk/nextjs";
import React from "react";

export function ClerkProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClerkProvider>{children}</ClerkProvider>;
}
