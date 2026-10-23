// Mutable "who is signed in" state shared by the Supabase mock (setup.ts) and
// the helpers/tests. Kept in its own module so both sides get the same instance.
export interface FakeUser {
  id: string;
  email?: string;
}

export const fakeAuth: { user: FakeUser | null } = { user: null };
