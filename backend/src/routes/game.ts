import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Start a game session (deduct 1 charge)
router.post('/start', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.charges < 1) {
      return res.status(403).json({ error: 'Insufficient charges. Watch an ad to earn more.' });
    }

    const seed = crypto.randomBytes(16).toString('hex');

    const [updatedUser, session] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { charges: { decrement: 1 } }
      }),
      prisma.gameSession.create({
        data: { userId, seed }
      })
    ]);

    res.json({ sessionId: session.id, seed, remainingCharges: updatedUser.charges });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start game session' });
  }
});

// Submit game score & validate anti-cheat limits
router.post('/submit', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { sessionId, score, timeElapsedSeconds } = req.body;

    if (!sessionId || typeof score !== 'number' || typeof timeElapsedSeconds !== 'number') {
      return res.status(400).json({ error: 'Missing or invalid parameters' });
    }

    const session = await prisma.gameSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId || session.isValidated) {
      return res.status(400).json({ error: 'Invalid or expired game session' });
    }

    // Anti-cheat rule: Maximum 100 points per second
    const maxAllowedScore = Math.max(timeElapsedSeconds * 100, 50);
    const isValidated = score <= maxAllowedScore;

    await prisma.gameSession.update({
      where: { id: sessionId },
      data: { score, endedAt: new Date(), isValidated }
    });

    if (isValidated) {
      const now = new Date();
      const weekNumber = Math.ceil(now.getDate() / 7);
      const year = now.getFullYear();

      // Check for an existing leaderboard entry for this week
      const existingEntry = await prisma.leaderboardEntry.findUnique({
        where: {
          userId_weekNumber_year: { userId, weekNumber, year }
        }
      });

      if (existingEntry) {
        // Update only if the new score is higher
        if (score > existingEntry.highScore) {
          await prisma.leaderboardEntry.update({
            where: { id: existingEntry.id },
            data: { highScore: score }
          });
        }
      } else {
        // Create new leaderboard entry
        await prisma.leaderboardEntry.create({
          data: { userId, weekNumber, year, highScore: score }
        });
      }
    }

    res.json({ validated: isValidated, score });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit score' });
  }
});

export default router;