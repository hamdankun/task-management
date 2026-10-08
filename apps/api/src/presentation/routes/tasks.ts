import { ChangeStatusSchema, CreateTaskSchema, UpdateTaskSchema } from '@tm/shared';
import { Router } from 'express';
import type { TaskService } from '../../application/task-service';
import { actorOf, parseBody, parseId } from '../parse';

// Thin: parse -> call service -> shape response. Check order (docs/04 §4): actor, id, body.
export const tasksRouter = (service: TaskService): Router =>
  Router()
    .get('/', (_req, res) => {
      res.json({ tasks: service.listTasks() });
    })
    .post('/', (req, res) => {
      const actor = actorOf(req);
      const task = service.createTask(actor, parseBody(CreateTaskSchema, req.body));
      res.status(201).location(`/api/tasks/${task.id}`).json({ task });
    })
    .get('/:id', (req, res) => {
      res.json({ task: service.getTask(parseId(req.params.id)) });
    })
    .patch('/:id', (req, res) => {
      const actor = actorOf(req);
      const id = parseId(req.params.id);
      res.json(service.updateTask(actor, id, parseBody(UpdateTaskSchema, req.body)));
    })
    .put('/:id/status', (req, res) => {
      const actor = actorOf(req);
      const id = parseId(req.params.id);
      const { status } = parseBody(ChangeStatusSchema, req.body);
      res.json(service.changeStatus(actor, id, status));
    })
    .delete('/:id', (req, res) => {
      const actor = actorOf(req);
      service.deleteTask(actor, parseId(req.params.id));
      res.status(204).end();
    })
    .get('/:id/audit-logs', (req, res) => {
      res.json({ auditLogs: service.listAuditLogs(parseId(req.params.id)) });
    });
