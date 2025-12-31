import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  code += '-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function main() {
  console.log('🌱 Seeding database...');

  // Create company with invite code
  const inviteCode = generateInviteCode();
  const company = await prisma.company.create({
    data: {
      name: 'Demo Construction Co',
      inviteCode: inviteCode,
      subscriptionTier: 'premium',
    },
  });

  console.log(`✅ Company created: ${company.name}`);
  console.log(`📋 Invite Code: ${inviteCode}`);

  // Create owner/admin user
  const passwordHash = await bcrypt.hash('admin123', 10);
  
  const owner = await prisma.user.create({
    data: {
      companyId: company.id,
      name: 'Admin User',
      phone: '+17348820690', // Your phone number
      email: 'admin@demo.com',
      role: 'OWNER',
      approvalStatus: 'APPROVED',
      passwordHash: passwordHash,
    },
  });

  console.log(`✅ Owner created: ${owner.name} (${owner.email})`);
  console.log(`🔑 Dashboard login: admin@demo.com / admin123`);

  // Create a sample job site
  const job = await prisma.job.create({
    data: {
      companyId: company.id,
      name: 'Main Office',
      address: '123 Construction Ave, Detroit, MI',
      geofenceCenter: '42.3314,-83.0458',
      geofenceRadiusMeters: 200,
    },
  });

  console.log(`✅ Job site created: ${job.name}`);

  console.log('\n========================================');
  console.log('🎉 Database seeded successfully!');
  console.log('========================================');
  console.log(`Company: ${company.name}`);
  console.log(`Invite Code: ${inviteCode}`);
  console.log(`Admin Email: admin@demo.com`);
  console.log(`Admin Password: admin123`);
  console.log(`Admin Phone: +17348820690`);
  console.log('========================================\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });