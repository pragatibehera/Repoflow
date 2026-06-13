import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import Razorpay from "razorpay";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { amount, credits } = body;

    if (!amount || !credits) {
      return NextResponse.json(
        { error: "Amount and credits are required" },
        { status: 400 }
      );
    }

    // Validate amount and credits
    if (amount <= 0 || credits <= 0) {
      return NextResponse.json(
        { error: "Invalid amount or credits" },
        { status: 400 }
      );
    }

    // Log order creation attempt
    console.log("🎯 Creating order for user:", {
      userId,
      amount,
      credits,
      timestamp: new Date().toISOString(),
    });

    const options = {
      amount: amount * 100, // Convert to cents
      currency: "USD",
      receipt: `receipt_${Date.now()}`,
      notes: {
        userId,
        credits: credits.toString(),
        environment: process.env.NODE_ENV,
      },
    };

    console.log("💳 Order options:", options);

    const order = await razorpay.orders.create(options);
    
    // Log successful order creation
    console.log("✅ Order created:", {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
    });
  } catch (error) {
    // Log detailed error information
    console.error("❌ Error creating order:", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });

    // Return appropriate error response
    if (error instanceof Error && error.message.includes("Invalid key")) {
      return NextResponse.json(
        { error: "Payment service configuration error" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create order" },
      { status: 500 }
    );
  }
  
}
