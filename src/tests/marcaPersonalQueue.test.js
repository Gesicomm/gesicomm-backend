'use strict';
const mockHooks={};
const mockAdd=jest.fn().mockResolvedValue({});
jest.mock('bullmq',()=>({Queue:jest.fn(()=>({add:mockAdd})),Worker:jest.fn(()=>({on:jest.fn()}))}));
jest.mock('../services/queue/redisConnection',()=>({getRedisConnection:()=>({})}));
jest.mock('../services/marcaPersonal.service',()=>({configured:()=>true,remote:()=>({managedIds:async()=>[]}),provisionUser:jest.fn()}));
jest.mock('../models',()=>({Usuario:{addHook:jest.fn((event,name,handler)=>{mockHooks[event]=handler;})}}));
const queue=require('../services/marcaPersonalQueue.service');
test('el alta no crea ni encola cuentas mientras la transacción pueda revertirse',async()=>{
  await queue.start(); mockAdd.mockClear();
  const transaction={afterCommit:jest.fn()};
  mockHooks.afterCreate({id:41},{transaction});
  expect(mockAdd).not.toHaveBeenCalled();
  expect(transaction.afterCommit).toHaveBeenCalledTimes(1);
  transaction.afterCommit.mock.calls[0][0]();
  await Promise.resolve();
  expect(mockAdd).toHaveBeenCalledWith('provision',{id:41},expect.objectContaining({jobId:'usuario-41',attempts:8}));
});
