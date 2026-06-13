import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Coins, Check } from "lucide-react";
import { toast } from "sonner";
import { api } from "~/trpc/react";

interface CreditPackage {
  credits: number;
  price: number;
  name: string;
  description: string;
}

const creditPackages: CreditPackage[] = [
  {
    credits: 5,
    price: 5,
    name: "Starter",
    description: "Perfect for small projects",
  },
  {
    credits: 10,
    price: 10,
    name: "Basic",
    description: "Ideal for medium projects",
  },
  {
    credits: 15,
    price: 15,
    name: "Pro",
    description: "For larger projects",
  },
  {
    credits: 50,
    price: 100,
    name: "Enterprise",
    description: "For large-scale projects",
  },
];

interface CreditPurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  requiredCredits?: number;
  onSuccess?: () => void;
}

export function CreditPurchaseModal({
  isOpen,
  onClose,
  requiredCredits,
  onSuccess,
}: CreditPurchaseModalProps) {
  const [selectedPackage, setSelectedPackage] = useState<CreditPackage | null>(
    null
  );
  const utils = api.useUtils();
  const { data: userCredits } = api.user.getCredits.useQuery();

  const handlePurchase = async () => {
    if (!selectedPackage) return;

    try {
      const response = await fetch("/api/razorpay", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: selectedPackage.price,
          credits: selectedPackage.credits,
        }),
      });

      const data = await response.json();

      const options = {
        key: data.key,
        amount: selectedPackage.price * 100,
        currency: "USD",
        name: "RepoFlow AI",
        description: `Purchase ${selectedPackage.credits} credits`,
        order_id: data.id,
        handler: async (response: any) => {
          toast.success("Credits purchased successfully!");
          await utils.user.getCredits.refetch();
          onSuccess?.();
          onClose();
        },
        prefill: {
          name: "User",
          email: "user@example.com",
        },
        theme: {
          color: "#0ea5e9",
        },
        modal: {
          confirm_close: true,
          escape: false,
        },
        payment_capture: 1,
        method: {
          card: true,
          netbanking: true,
          upi: false,
          cash: false,
        },
      };

      if (typeof window !== 'undefined' && (window as any).Razorpay) {
        const razorpay = new (window as any).Razorpay(options);
        razorpay.open();
      } else {
        toast.error("Payment system is not ready. Please try again.");
      }
    } catch (error) {
      console.error("Error initiating purchase:", error);
      toast.error("Failed to initiate purchase");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            Purchase Credits
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex items-center justify-between rounded-lg bg-primary/10 p-4">
            <div className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-primary" />
              <span className="font-medium">Available Credits</span>
            </div>
            <span className="text-lg font-bold">{userCredits?.credits ?? 0}</span>
          </div>
          {requiredCredits && (
            <div className="text-sm text-muted-foreground">
              This project requires {requiredCredits} credits
            </div>
          )}
          <div className="grid gap-4">
            {creditPackages.map((pkg) => (
              <Card
                key={pkg.credits}
                className={`cursor-pointer p-4 transition-colors ${
                  selectedPackage?.credits === pkg.credits
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted"
                }`}
                onClick={() => setSelectedPackage(pkg)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">{pkg.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {pkg.description}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">${pkg.price}</div>
                    <div className="text-sm text-muted-foreground">
                      {pkg.credits} credits
                    </div>
                  </div>
                </div>
                {selectedPackage?.credits === pkg.credits && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-primary">
                    <Check className="h-4 w-4" />
                    <span>Selected</span>
                  </div>
                )}
              </Card>
            ))}
          </div>
          <Button
            className="w-full"
            onClick={handlePurchase}
            disabled={!selectedPackage}
          >
            Purchase Credits
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
