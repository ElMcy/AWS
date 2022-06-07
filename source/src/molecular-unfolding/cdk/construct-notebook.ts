/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/


import {
  readFileSync,
} from 'fs';

import {
  aws_s3 as s3,
  aws_kms as kms,
  aws_ec2 as ec2,
} from 'aws-cdk-lib';

import {
  CfnNotebookInstanceLifecycleConfig,
  CfnNotebookInstance,
  CfnCodeRepository
} from 'aws-cdk-lib/aws-sagemaker';


import {
  Construct,
} from 'constructs';

import {
  RoleUtil,
} from './utils/utils-role';
import {
  MainStack
} from './stack-main';


export interface Props {
  region: string;
  account: string;
  bucket: s3.Bucket;
  prefix: string;
  notebookSg: ec2.SecurityGroup;
  vpc: ec2.Vpc;
  stackName: string;
}

export class Notebook extends Construct {

  notebookUrl: string;
  private props: Props;
  private roleUtil: RoleUtil;

  // constructor
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);
    this.props = props;
    const INSTANCE_TYPE = 'ml.c5.xlarge';

    this.roleUtil = RoleUtil.newInstance(this, props);

    const repositoryUrl = 'https://github.com/awslabs/quantum-computing-exploration-for-drug-discovery-on-aws';

    const codeRepository = new CfnCodeRepository(scope, 'CodeRepository', {
      codeRepositoryName: 'quantum-computing-exploration-for-drug-discovery-on-aws',
      gitConfig: {
        branch: MainStack.SOLUTION_VERSION,
        repositoryUrl,
      }
    });

    const defaultCodeRepository = this.node.tryGetContext('default_code_repository') || codeRepository.codeRepositoryName;

    const notebookRole = this.roleUtil.createNotebookIamRole();

    let onStartContent = readFileSync(`${__dirname}/resources/onStart.template`, 'utf-8');

    onStartContent = onStartContent.replace('__S3_BUCKET__', this.props.bucket.bucketName);

    const base64Encode = (str: string): string => Buffer.from(str, 'binary').toString('base64');
    const onStartContentBase64 = base64Encode(onStartContent);

    const installBraketSdk = new CfnNotebookInstanceLifecycleConfig(this, 'install-braket-sdk', {
      onStart: [{
        content: onStartContentBase64,
      }],
    });

    const qcNotebookKey = new kms.Key(this, 'qcNotebookKey', {
      enableKeyRotation: true,
    });

    const notebookInstance = new CfnNotebookInstance(this, 'Notebook', {
      instanceType: INSTANCE_TYPE,
      roleArn: notebookRole.roleArn,
      rootAccess: 'Enabled', // Lifecycle configurations need root access to be able to set up a notebook instance
      lifecycleConfigName: installBraketSdk.attrNotebookInstanceLifecycleConfigName,
      volumeSizeInGb: 50,
      kmsKeyId: qcNotebookKey.keyId,
      securityGroupIds: [this.props.notebookSg.securityGroupId],
      subnetId: this.props.vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
      }).subnetIds[0],
      directInternetAccess: 'Disabled',
      defaultCodeRepository: defaultCodeRepository,
    });

    this.notebookUrl = `https://${notebookInstance.attrNotebookInstanceName}.notebook.${this.props.region}.sagemaker.aws/notebooks/quantum-computing-exploration-for-drug-discovery-on-aws/source/src/molecular-unfolding/molecular_unfolding.ipynb`;
  }

}