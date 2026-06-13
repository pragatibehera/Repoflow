"use client";

import { SignIn } from "@clerk/nextjs";
import { motion } from "framer-motion";

export default function Page() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background">
      {/* Animated gradient background */}
      <motion.div
        className="absolute inset-0 overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <motion.div
          initial={{ x: -100, opacity: 0.5 }}
          animate={{
            x: 0,
            opacity: [0.4, 0.6, 0.4],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: "linear",
          }}
          className="absolute left-0 top-1/4 h-[500px] w-[500px] rounded-full bg-gradient-to-r from-primary/20 via-primary/5 to-transparent blur-3xl"
        />
        <motion.div
          initial={{ x: 100, opacity: 0.5 }}
          animate={{
            x: 0,
            opacity: [0.4, 0.6, 0.4],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: "linear",
            delay: 1,
          }}
          className="absolute right-0 top-2/4 h-[400px] w-[400px] rounded-full bg-gradient-to-l from-secondary/20 via-secondary/5 to-transparent blur-3xl"
        />
      </motion.div>

      {/* Grid pattern overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,black_20%,transparent_100%)]" />

      {/* Card container */}
      <div className="relative z-10">
        <SignIn />
      </div>
    </div>
  );
}
