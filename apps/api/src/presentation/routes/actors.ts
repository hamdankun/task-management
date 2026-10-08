import { Router } from 'express';
import type { TaskService } from '../../application/task-service';

export const actorsRouter = (service: TaskService): Router =>
  Router().get('/', (_req, res) => {
    res.json({ actors: service.listActors() });
  });
