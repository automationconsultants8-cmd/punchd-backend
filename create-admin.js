const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.create({
    data: {
      companyId: 'cbacfa6a-3038-4369-b43b-e4450da35bcd', // YOUR COMPANY ID (same as before)
      name: 'Admin User',
      phone: '+15559999999',
      role: 'ADMIN',
      isActive: true,
    },
  });
  
  console.log('✅ Admin user created!');
  console.log('Phone:', admin.phone);
  console.log('Role:', admin.role);
  console.log('\nUse this phone to login to admin dashboard: +15559999999');
}

main()
  .catch((error) => {
    console.error('❌ Error:', error.message);
  })
  .finally(() => prisma.$disconnect());