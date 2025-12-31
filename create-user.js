const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.create({
    data: {
      companyId: 'cbacfa6a-3038-4369-b43b-e4450da35bcd',
      name: 'Test Worker',
      phone: '+15551234567',
      role: 'WORKER',
      isActive: true,
    },
  });
  
  console.log('✅ User created successfully!');
  console.log('Name:', user.name);
  console.log('Phone:', user.phone);
  console.log('Role:', user.role);
}

main()
  .catch((error) => {
    console.error('❌ Error:', error.message);
  })
  .finally(() => prisma.$disconnect());