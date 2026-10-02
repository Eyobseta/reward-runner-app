import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Reward user with 1 charge for watching an ad
router.post('/reward', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { rewardToken } = req.body;

    if (!rewardToken) {
      return res.status(400).json({ error: 'Reward token required' });
    }

    const existingLog = await prisma.adWatchLog.findUnique({ where: { rewardToken } });
    if (existingLog) {
      return res.status(400).json({ error: 'Reward token already claimed' });
    }

    const [adLog, updatedUser] = await prisma.$transaction([
      prisma.adWatchLog.create({
        data: { userId, rewardToken, chargesGranted: 1 }
      }),
      prisma.user.update({
        where: { id: userId },
        data: { charges: { increment: 1 } }
      })
    ]);

    res.json({ charges: updatedUser.charges, message: 'Charge granted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to credit ad reward' });
  }
});

export default router;