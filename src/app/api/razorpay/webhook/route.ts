import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import crypto from "crypto";
import { db } from "~/server/db";
import { clerkClient } from "@clerk/clerk-sdk-node";
import { sendPaymentSuccessEmail, sendPaymentFailedEmail } from "~/lib/email";

// Export middleware to bypass auth for webhook
export const middleware = {
  matcher: ["/api/razorpay/webhook"],
};

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

export async function POST(req: Request) {
  try {
    console.log("🎯 Webhook received at:", new Date().toISOString());
    
    const headersList = await headers();
    const headersObj = Object.fromEntries(headersList.entries());
    console.log("🔍 Webhook headers:", headersObj);
    
    const signature = headersList.get("x-razorpay-signature");
    console.log("🔑 Signature present:", !!signature);
    
    if (!signature || !WEBHOOK_SECRET) {
      console.error("❌ Missing signature or webhook secret");
      return NextResponse.json(
        { error: "Missing signature or webhook secret" },
        { status: 400 }
      );
    }

    const body = await req.text();
    console.log("📦 Webhook payload:", body);
    
    const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
    hmac.update(body);
    const generatedSignature = hmac.digest("hex");
    
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(generatedSignature)
    );
    
    console.log("🔐 Signature verification:", isValid);
    
    if (!isValid) {
      console.error("❌ Invalid signature");
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 400 }
      );
    }

    const payload = JSON.parse(body);
    console.log("📋 Event type:", payload.event);
    
    if (payload.event === "payment.captured") {
      const payment = payload.payload.payment.entity;
      const orderId = payment.order_id;
      const amount = payment.amount / 100; // Convert from cents to dollars
      const credits = parseInt(payment.notes.credits);
      const userId = payment.notes.userId;

      // Get user email from Clerk
      const user = await clerkClient.users.getUser(userId);
      const userEmail = user.emailAddresses[0]?.emailAddress;

      if (!userEmail) {
        console.error("❌ User email not found:", { userId });
        return NextResponse.json(
          { error: "User email not found" },
          { status: 400 }
        );
      }

      // Start a transaction
      const result = await db.$transaction(async (tx) => {
        // Check if user exists
        const existingUser = await tx.user.findUnique({
          where: { id: userId },
        });

        if (!existingUser) {
          // Create new user if they don't exist
          const clerkUser = await clerkClient.users.getUser(userId);
          const newUser = await tx.user.create({
            data: {
              id: userId,
              emailAddress: userEmail,
              firstName: clerkUser.firstName || "",
              lastName: clerkUser.lastName || "",
              credits: credits,
            },
          });
          console.log("👤 New user created:", {
            userId,
            email: userEmail,
            credits,
            timestamp: new Date().toISOString(),
          });
          return newUser;
        }

        // Update existing user's credits
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: {
            credits: {
              increment: credits,
            },
          },
        });
        console.log("💳 User credits updated:", {
          userId,
          currentCredits: updatedUser.credits,
          addedCredits: credits,
          timestamp: new Date().toISOString(),
        });
        return updatedUser;
      });

      // Send success email
      await sendPaymentSuccessEmail(userEmail, amount, credits);
      console.log("📧 Success email sent:", {
        userId,
        email: userEmail,
        amount,
        credits,
        timestamp: new Date().toISOString(),
      });

      return NextResponse.json({ success: true });
    }

    // Handle payment failed event
    if (payload.event === "payment.failed") {
      const payment = payload.payload.payment.entity;
      const amount = payment.amount / 100; // Convert from cents to dollars
      const userId = payment.notes.userId;

      // Get user email from Clerk
      const user = await clerkClient.users.getUser(userId);
      const userEmail = user.emailAddresses[0]?.emailAddress;

      if (userEmail) {
        // Send failure email
        await sendPaymentFailedEmail(userEmail, amount, payment.error_description || "Unknown error");
        console.log("📧 Failure email sent:", {
          userId,
          email: userEmail,
          amount,
          error: payment.error_description,
          timestamp: new Date().toISOString(),
        });
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("❌ Webhook error:", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
