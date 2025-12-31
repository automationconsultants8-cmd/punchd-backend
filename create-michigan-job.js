const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const job = await prisma.job.create({
    data: {
      companyId: 'cbacfa6a-3038-4369-b43b-e4450da35bcd', // YOUR COMPANY ID
      name: 'Michigan Test Site',
      address: 'Current Location - Michigan',
      geofenceCenter: '42.490709,-83.268742',
      geofenceRadiusMeters: 1000, // 1km radius so you're definitely inside!
      isActive: true,
    },
  });
  
  console.log('✅ Michigan job site created!');
  console.log('Name:', job.name);
  console.log('Location:', job.geofenceCenter);
  console.log('Radius:', job.geofenceRadiusMeters, 'meters');
}

main()
  .catch((error) => {
    console.error('❌ Error:', error.message);
  })
  .finally(() => prisma.$disconnect());