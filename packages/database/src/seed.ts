import 'dotenv/config';
import { hash, argon2id } from 'argon2';
import { z } from 'zod';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLE_NAMES } from '@restaurant/shared-types';
import { email, password } from '@restaurant/validation';
import { createDatabase } from './index';

export async function seed() {
  const config = z
    .object({
      SEED_ORGANIZATION_SLUG: z.string().regex(/^[a-z0-9-]{1,80}$/),
      SEED_ORGANIZATION_NAME: z.string().min(1).max(160),
      SEED_BRANCH_CODE: z.string().min(1).max(40),
      SEED_BRANCH_NAME: z.string().min(1).max(160),
      SEED_OWNER_EMAIL: email,
      SEED_OWNER_NAME: z.string().min(1).max(100),
      SEED_OWNER_PASSWORD: password,
    })
    .parse(process.env);
  if (Object.values(config).some((value) => value.includes('CHANGE_ME')))
    throw new Error('Replace bootstrap placeholders before seeding');
  const db = createDatabase(process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL);
  const passwordHash = await hash(config.SEED_OWNER_PASSWORD, {
    type: argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
  try {
    await db.$transaction(
      async (tx) => {
        // Serialize bootstrap without requiring any fixed business identifier.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(9472831)`;
        const org = await tx.organization.upsert({
          where: { slug: config.SEED_ORGANIZATION_SLUG },
          update: {},
          create: { slug: config.SEED_ORGANIZATION_SLUG, name: config.SEED_ORGANIZATION_NAME },
        });
        const branch = await tx.branch.upsert({
          where: { organizationId_code: { organizationId: org.id, code: config.SEED_BRANCH_CODE } },
          update: {},
          create: {
            organizationId: org.id,
            code: config.SEED_BRANCH_CODE,
            name: config.SEED_BRANCH_NAME,
          },
        });
        for (const key of PERMISSIONS)
          await tx.permission.upsert({
            where: { key },
            update: {},
            create: { key, description: key.replace('.', ': ') },
          });
        let ownerRoleId = '';
        for (const name of ROLE_NAMES) {
          let role = await tx.role.findUnique({
            where: { organizationId_name: { organizationId: org.id, name } },
          });
          if (!role)
            role = await tx.role.create({
              data: {
                organizationId: org.id,
                name,
                protected: name === 'OWNER',
                permissions: {
                  create: DEFAULT_ROLE_PERMISSIONS[name].map((permissionKey) => ({
                    permissionKey,
                  })),
                },
              },
            });
          if (name === 'OWNER') ownerRoleId = role.id;
        }
        // Only the first bootstrap creates an owner. Re-running never resets passwords or grants.
        const existingOwner = await tx.userBranchRole.findFirst({
          where: { organizationId: org.id, branchId: branch.id, roleId: ownerRoleId },
        });
        if (!existingOwner) {
          const user = await tx.user.upsert({
            where: {
              organizationId_email: { organizationId: org.id, email: config.SEED_OWNER_EMAIL },
            },
            update: {},
            create: {
              organizationId: org.id,
              email: config.SEED_OWNER_EMAIL,
              name: config.SEED_OWNER_NAME,
              passwordHash,
            },
          });
          await tx.branchMembership.upsert({
            where: { userId_branchId: { userId: user.id, branchId: branch.id } },
            update: {},
            create: { userId: user.id, branchId: branch.id, organizationId: org.id },
          });
          await tx.userBranchRole.create({
            data: {
              userId: user.id,
              branchId: branch.id,
              organizationId: org.id,
              roleId: ownerRoleId,
            },
          });
          await tx.auditLog.create({
            data: {
              organizationId: org.id,
              branchId: branch.id,
              userId: user.id,
              action: 'system.bootstrap',
              entityType: 'Organization',
              entityId: org.id,
              afterData: { ownerCreated: true },
            },
          });
        }
      },
      { timeout: 15000 },
    );
  } finally {
    await db.$disconnect();
  }
}
if (require.main === module)
  seed().catch(() => {
    console.error('Bootstrap failed. Check configuration and database availability.');
    process.exitCode = 1;
  });
