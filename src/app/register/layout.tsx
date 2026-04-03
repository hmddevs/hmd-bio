import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Register — HMD.bio",
  description: "Create your HMD.bio account",
};

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
