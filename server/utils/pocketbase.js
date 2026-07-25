import PocketBase from "pocketbase";

const stateKey = Symbol.for("dspeak.pocketbase.admin");

async function createAdminClient() {
  const config = useRuntimeConfig();
  const url = process.env.POCKETBASE_URL || config.pocketbase.url;
  const email = process.env.PBASE_ADMIN_EMAIL || config.pocketbase.adminEmail;
  const password =
    process.env.PBASE_ADMIN_PASSWORD || config.pocketbase.adminPassword;

  if (!url || !email || !password) {
    throw new Error(
      "POCKETBASE_URL, PBASE_ADMIN_EMAIL and PBASE_ADMIN_PASSWORD are required",
    );
  }

  const client = new PocketBase(url);
  client.autoCancellation(false);

  try {
    await client.collection("_superusers").authWithPassword(email, password);
  } catch (error) {
    if (!client.admins?.authWithPassword) throw error;
    await client.admins.authWithPassword(email, password);
  }

  return client;
}

export async function usePocketBaseAdmin() {
  if (!globalThis[stateKey]) {
    globalThis[stateKey] = createAdminClient().catch((error) => {
      delete globalThis[stateKey];
      throw error;
    });
  }

  const client = await globalThis[stateKey];
  if (!client.authStore.isValid) {
    delete globalThis[stateKey];
    return usePocketBaseAdmin();
  }
  return client;
}
