'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

export default function SyncUserPage() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Starting sync...');

  useEffect(() => {
    const syncUser = async () => {
      try {
        if (!isLoaded || !isSignedIn) {
          setStatus('Waiting for authentication...');
          return;
        }

        setStatus('Fetching user data...');
        const response = await fetch('/api/sync-user');
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to sync user');
        }

        if (!data.success) {
          throw new Error('Failed to sync user');
        }

        setStatus('Sync completed successfully!');
        console.log('User synced successfully:', data.user);
        
        // Wait a moment to show success message
        setTimeout(() => {
          router.push('/create');
        }, 2000);
      } catch (error) {
        console.error('Error syncing user:', error);
        setError(error instanceof Error ? error.message : 'Failed to sync user');
        setStatus('Sync failed');
        // Wait a bit before redirecting to show the error
        setTimeout(() => {
          router.push('/sign-in');
        }, 3000);
      }
    };

    syncUser();
  }, [router, isLoaded, isSignedIn]);

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-gray-900">Loading...</h1>
          <p className="mt-2 text-gray-600">Please wait while we check your authentication status.</p>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-red-600">Authentication Required</h1>
          <p className="mt-2 text-gray-600">Please sign in to continue.</p>
          <p className="mt-2 text-sm text-gray-500">Redirecting to sign-in...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-red-600">Error</h1>
          <p className="mt-2 text-gray-600">{error}</p>
          <p className="mt-2 text-sm text-gray-500">Redirecting to sign-in...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-gray-900">Syncing your account...</h1>
        <p className="mt-2 text-gray-600">{status}</p>
        <p className="mt-2 text-sm text-gray-500">Please wait while we set up your profile.</p>
      </div>
    </div>
  );
}
