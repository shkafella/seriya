import 'dotenv/config'

import { createPrisma } from '../src/db'
import { hashPassword } from '../src/modules/auth/infrastructure/passwords'

const command = process.argv[2]
const databaseUrl = process.env.DATABASE_URL
const email = process.env.OWNER_EMAIL?.trim().toLowerCase()
const password = process.env.OWNER_PASSWORD
const displayName = process.env.OWNER_DISPLAY_NAME?.trim() || 'Владелец каталога'

if (!databaseUrl || !email || !password || password.length < 8) {
  throw new Error('DATABASE_URL, OWNER_EMAIL, and OWNER_PASSWORD (8+ chars) are required')
}
if (!['bootstrap', 'recover'].includes(command ?? '')) throw new Error('Usage: catalog-owner.ts bootstrap|recover')

const db = createPrisma(databaseUrl)
try {
  const passwordHash = await hashPassword(password)
  await db.$transaction(async (tx) => {
    const owner = await tx.ownerIdentity.findUnique({ where: { singletonKey: 'owner' }, include: { user: true } })
    if (command === 'bootstrap') {
      if (owner) throw new Error('Owner identity already exists; use recover')
      const user = await tx.user.upsert({
        where: { email },
        create: { email, passwordHash, displayName },
        update: { passwordHash, displayName },
      })
      await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })
      await tx.ownerIdentity.create({ data: { singletonKey: 'owner', userId: user.id } })
      console.log(`Owner identity bound to ${email}`)
      return
    }
    if (!owner) throw new Error('Owner identity does not exist; use bootstrap')
    await tx.user.update({ where: { id: owner.userId }, data: { email, passwordHash, displayName } })
    await tx.authSession.updateMany({ where: { userId: owner.userId, revokedAt: null }, data: { revokedAt: new Date() } })
    console.log(`Owner credentials recovered and all sessions revoked for ${email}`)
  })
} finally {
  await db.$disconnect()
}
