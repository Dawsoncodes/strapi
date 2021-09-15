'use strict';

const { extendType, nonNull } = require('nexus');
const { omit, isNil } = require('lodash/fp');
const { getNonWritableAttributes } = require('@strapi/utils').contentTypes;

const sanitizeInput = (contentType, data) => omit(getNonWritableAttributes(contentType), data);

module.exports = ({ strapi }) => {
  const { service: getService } = strapi.plugin('graphql');

  const { naming } = getService('utils');
  const { transformArgs } = getService('builders').utils;

  const {
    getUpdateMutationTypeName,
    getEntityResponseName,
    getContentTypeInputName,
    getDeleteMutationTypeName,
  } = naming;

  const addUpdateMutation = (t, contentType) => {
    const { uid } = contentType;

    const updateMutationName = getUpdateMutationTypeName(contentType);
    const responseTypeName = getEntityResponseName(contentType);

    t.field(updateMutationName, {
      type: responseTypeName,

      args: {
        // Update payload
        data: nonNull(getContentTypeInputName(contentType)),
      },

      async resolve(parent, args) {
        const transformedArgs = transformArgs(args, { contentType });

        // Sanitize input data
        Object.assign(transformedArgs, { data: sanitizeInput(contentType, transformedArgs.data) });

        const { create, update } = getService('builders')
          .get('content-api')
          .buildMutationsResolvers({ contentType });

        const findParams = omit(['data', 'files'], transformedArgs);
        const entity = await strapi.entityService.find(uid, { params: findParams });

        // Create or update
        const value = isNil(entity)
          ? create(parent, transformedArgs)
          : update(uid, { id: entity.id, data: transformedArgs.data });

        return { value: value, info: { args: transformedArgs, resourceUID: uid } };
      },
    });
  };

  const addDeleteMutation = (t, contentType) => {
    const { uid } = contentType;

    const deleteMutationName = getDeleteMutationTypeName(contentType);
    const responseTypeName = getEntityResponseName(contentType);

    t.field(deleteMutationName, {
      type: responseTypeName,

      args: {},

      async resolve(parent, args) {
        const transformedArgs = transformArgs(args, { contentType });

        Object.assign(transformedArgs, { data: sanitizeInput(contentType, transformedArgs.data) });

        const { delete: deleteResolver } = getService('builders')
          .get('content-api')
          .buildMutationsResolvers({ contentType });

        const params = omit(['data', 'files'], transformedArgs);
        const entity = await strapi.entityService.find(uid, { params });

        if (!entity) {
          throw new Error('Entity not found');
        }

        const value = await deleteResolver(parent, { id: entity.id, params });

        return { value, info: { args: transformedArgs, resourceUID: uid } };
      },
    });
  };

  return {
    buildSingleTypeMutations(contentType) {
      const updateMutationName = `Mutation.${getUpdateMutationTypeName(contentType)}`;
      const deleteMutationName = `Mutation.${getDeleteMutationTypeName(contentType)}`;

      const extension = getService('extension');

      const registerAuthConfig = (action, auth) => {
        return extension.use(() => ({ resolversConfig: { [action]: { auth } } }));
      };

      const isActionEnabled = action => {
        return extension.shadowCRUD(contentType.uid).isActionEnabled(action);
      };

      const isUpdateEnabled = isActionEnabled('update');
      const isDeleteEnabled = isActionEnabled('delete');

      if (isUpdateEnabled) {
        registerAuthConfig(updateMutationName, { scope: [`${contentType.uid}.update`] });
      }

      if (isDeleteEnabled) {
        registerAuthConfig(deleteMutationName, { scope: [`${contentType.uid}.delete`] });
      }

      return extendType({
        type: 'Mutation',

        definition(t) {
          if (isUpdateEnabled) {
            addUpdateMutation(t, contentType);
          }

          if (isDeleteEnabled) {
            addDeleteMutation(t, contentType);
          }
        },
      });
    },
  };
};
